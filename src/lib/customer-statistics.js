// Aggregate inside the join so a customer's history never becomes a large
// embedded array. Keep historical invoice inclusion and numeric semantics.
export function customerSaleStats() {
  return [
    { $lookup: {
      from: "sales", localField: "_id", foreignField: "customerId",
      pipeline: [{ $group: {
        _id: null, purchaseCount: { $sum: 1 }, totalSpent: { $sum: "$total" },
        averageBill: { $avg: "$total" }, highestBill: { $max: "$total" },
        firstPurchaseAt: { $min: "$createdAt" }, lastPurchaseAt: { $max: "$createdAt" },
      } }], as: "customerSales",
    } },
    { $addFields: { ...Object.fromEntries(
      ["purchaseCount", "totalSpent", "averageBill", "highestBill", "firstPurchaseAt", "lastPurchaseAt"]
        .map(field => [field, { $ifNull: [{ $arrayElemAt: [`$customerSales.${field}`, 0] }, field.endsWith("At") ? null : 0] }]),
    ), averageBill: { $cond: [
      { $gt: [{ $ifNull: [{ $arrayElemAt: ["$customerSales.purchaseCount", 0] }, 0] }, 0] },
      { $arrayElemAt: ["$customerSales.averageBill", 0] }, 0,
    ] } } },
    { $unset: "customerSales" },
  ];
}
