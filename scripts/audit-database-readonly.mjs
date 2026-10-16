// Native driver only: never imports models, creates indexes, seeds or writes data.
import nextEnv from "@next/env";
import mongoose from "mongoose";
import { writeFile } from "node:fs/promises";
import { customerSaleStats } from "../src/lib/customer-statistics.js";
import { buildAccountLedger, LEDGER_SALE_FIELDS, LEDGER_EXPENSE_FIELDS, LEDGER_CONSULTATION_FIELDS } from "../src/services/accounting.service.js";
nextEnv.loadEnvConfig(process.cwd(), false);
const result = { readOnly: true, measuredAt: new Date().toISOString(), queries: [] };
const client = new mongoose.mongo.MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 15000, maxPoolSize: 2 });
try {
  await client.connect();
  const db = client.db();
  for (const name of ["products", "inventorybatches", "sales", "customers", "categories", "purchases", "expenses", "settings"]) {
    const collection = db.collection(name);
    result[name] = { count: await collection.countDocuments({}, { maxTimeMS: 10000 }), indexes: (await collection.indexes()).map(({ key, unique }) => ({ key, ...(unique ? { unique } : {}) })) };
  }
  for (const [name, filter, sort] of [
    ["products", { active: true, visibleInSales: { $ne: false } }, { name: 1 }],
    ["products", { barcode: "__audit_nonexistent_barcode__" }, null],
    ["sales", {}, { createdAt: -1 }],
  ]) {
    let query = db.collection(name).find(filter, { projection: { _id: 1 }, maxTimeMS: 10000 }).limit(20);
    if (sort) query = query.sort(sort);
    const explain = await query.explain("executionStats");
    result.queries.push({ name, filter, sort, plan: explain.queryPlanner.winningPlan,
      executionMs: explain.executionStats.executionTimeMillis, documents: explain.executionStats.totalDocsExamined,
      keys: explain.executionStats.totalKeysExamined, returned: explain.executionStats.nReturned });
  }
  const before = [
    { $lookup: { from: "sales", localField: "_id", foreignField: "customerId", as: "customerSales" } },
    { $addFields: { purchaseCount: { $size: "$customerSales" }, totalSpent: { $sum: "$customerSales.total" }, averageBill: { $cond: [{ $gt: [{ $size: "$customerSales" }, 0] }, { $avg: "$customerSales.total" }, 0] }, highestBill: { $ifNull: [{ $max: "$customerSales.total" }, 0] }, firstPurchaseAt: { $min: "$customerSales.createdAt" }, lastPurchaseAt: { $max: "$customerSales.createdAt" } } },
    { $unset: "customerSales" },
  ];
  const projection = { $project: { purchaseCount: 1, totalSpent: 1, averageBill: 1, highestBill: 1, firstPurchaseAt: 1, lastPurchaseAt: 1 } };
  const samples = [];
  let equal = true;
  for (let cycle = 0; cycle < 5; cycle++) {
    const outputs = [];
    const times = {};
    for (const [label, stages] of [["before", before], ["after", customerSaleStats()]]) {
      const start = performance.now();
      outputs.push(await db.collection("customers").aggregate([{ $sort: { _id: 1 } }, { $limit: 100 }, ...stages, projection], { maxTimeMS: 10000 }).toArray());
      times[`${label}Ms`] = performance.now() - start;
    }
    equal &&= JSON.stringify(outputs[0]) === JSON.stringify(outputs[1]);
    samples.push(times);
  }
  result.customerStats = { samples, outputsEqual: equal, sampleLimit: 100 };
  result.customerStats.sampledCustomers = Math.min(result.customers.count, 100);
  // Exercise actual MongoDB aggregation semantics with synthetic $documents.
  // These records exist only in the read command; nothing is inserted.
  const fixtures = [[], [{ total: 0 }], [{ total: null }],
    [{ total: 12.5, createdAt: new Date("2026-01-01") }, { total: 7.5, createdAt: new Date("2026-02-01") }],
    [{ total: 100, documentStatus: "CANCELLED" }, { total: 50 }]];
  for (const history of fixtures) {
    const [grouped] = history.length ? await db.aggregate([{ $documents: history }, ...customerSaleStats()[0].$lookup.pipeline]).toArray() : [];
    const [oldStats] = await db.aggregate([{ $documents: [{ customerSales: history }] }, before[1], before[2]]).toArray();
    const [newStats] = await db.aggregate([{ $documents: [{ customerSales: grouped ? [grouped] : [] }] }, ...customerSaleStats().slice(1)]).toArray();
    if (JSON.stringify(oldStats) !== JSON.stringify(newStats)) throw new Error("Fixture statistics mismatch");
  }
  result.customerStats.mongoFixtureCasesPassed = fixtures.length;
  const ledgerFixtures = [
    { sales: [{ _id: "sale", createdAt: new Date("2026-01-01"), invoiceNumber: "FIXTURE-1", total: 100, payments: [{ method: "CASH", amount: 80 }, { method: "BANK", amount: 20, reference: "fixture" }], customerSnapshot: { name: "Fixture Customer", address: "not needed" }, cashierSnapshot: { name: "Fixture Cashier" }, items: [{ kind: "PRODUCT", name: "Fixture", allocations: Array(100).fill({ batch: "fixture" }) }, { kind: "MIX", ingredients: Array(100).fill({ name: "fixture" }) }] }], expenses: [], consultations: [] },
    { sales: [], expenses: [{ _id: "expense", amount: 20, source: "MANUAL", status: "ACTIVE", expenseDate: new Date("2026-01-02"), category: "Fixture", title: "Fixture expense", actorId: { name: "Fixture Staff" }, paymentMethod: "CASH", paymentReference: "fixture" }], consultations: [{ _id: "consultation", opNumber: "FIXTURE-OP", patient: { name: "Fixture Patient", phone: "not needed" }, consultationFee: 50, paymentMethod: "BANK", createdAt: new Date("2026-01-01"), status: "CANCELLED", refundedAmount: 25, cancelledAt: new Date("2026-01-02"), cancellationReason: "fixture", refundReference: "fixture" }] },
  ];
  let originalBytes = 0, projectedBytes = 0;
  for (const fixture of ledgerFixtures) {
    const projected = {};
    for (const [name, fields] of [["sales", LEDGER_SALE_FIELDS], ["expenses", LEDGER_EXPENSE_FIELDS], ["consultations", LEDGER_CONSULTATION_FIELDS]]) {
      projected[name] = fixture[name].length ? await db.aggregate([{ $documents: fixture[name] }, { $project: Object.fromEntries(fields.split(" ").map(field => [field, 1])) }]).toArray() : [];
    }
    const ledger = data => buildAccountLedger(data.sales, data.expenses, { consultations: data.consultations, enabledMethods: ["CASH", "BANK"] });
    if (JSON.stringify(ledger(fixture)) !== JSON.stringify(ledger(projected))) throw new Error("Ledger projection fixture mismatch");
    originalBytes += Buffer.byteLength(JSON.stringify(fixture));
    projectedBytes += Buffer.byteLength(JSON.stringify(projected));
  }
  result.ledgerProjection = { mongoFixtureCasesPassed: ledgerFixtures.length, originalBytes, projectedBytes, outputsEqual: true };
} catch (error) {
  result.unavailable = error.name; // Never print URI, credentials, records or error messages.
  process.exitCode = 1;
} finally {
  await client.close();
  await writeFile("docs/audits/2026-10-16/database.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ readOnly: true, unavailable: result.unavailable || null, counts: Object.fromEntries(Object.entries(result).filter(([, v]) => v?.count !== undefined).map(([k, v]) => [k, v.count])), customerStats: result.customerStats }, null, 2));
}
