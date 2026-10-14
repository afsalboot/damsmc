// Full-document fingerprints; no tokens, customer data or database documents are printed.
import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const phase = process.argv[2];
if (!["before", "after"].includes(phase)) throw Error("Choose before or after");
try {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const result = {};
  for (const collection of ["sales", "inventorybatches", "stocktransactions"]) {
    const hash = createHash("sha256"); let count = 0;
    for await (const row of mongoose.connection.db.collection(collection).find({}).sort({ _id: 1 })) { hash.update(JSON.stringify(row)); count++; }
    result[collection] = { count, hash: hash.digest("hex") };
  }
  await mkdir("performance-results", { recursive: true }); await writeFile(`performance-results/checkout-${phase}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await mongoose.disconnect(); }
