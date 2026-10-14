// Read-only inspection. No model init, seed, token construction or index changes.
import mongoose from "mongoose";
try {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  for (const name of ["products", "inventorybatches"]) console.log(name, JSON.stringify(await db.collection(name).indexes()));
  const products = db.collection("products");
  console.log("catalogueCount", await products.countDocuments({ active: true, visibleInSales: { $ne: false } }));
  for (const filter of [{ active: true, visibleInSales: { $ne: false } }, { barcode: "0000000000000" }]) {
    const result = await products.find(filter, { projection: { name: 1, sku: 1, barcode: 1, categoryId: 1, updatedAt: 1 } }).sort({ name: 1 }).explain("executionStats");
    console.log(JSON.stringify({ filter, plan: result.queryPlanner.winningPlan, milliseconds: result.executionStats.executionTimeMillis, documentsExamined: result.executionStats.totalDocsExamined, keysExamined: result.executionStats.totalKeysExamined, returned: result.executionStats.nReturned }));
  }
} catch (error) { console.error(error.name, "Read-only database inspection unavailable"); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
