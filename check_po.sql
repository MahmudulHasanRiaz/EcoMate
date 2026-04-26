-- Check if there are PurchaseOrders with the specific supplierId
SELECT id, "supplierId", type, "createdAt"
FROM "PurchaseOrder"
WHERE "supplierId" = 'cmlnmm6si0003urs4jrptkhvw'
ORDER BY "createdAt" DESC;
