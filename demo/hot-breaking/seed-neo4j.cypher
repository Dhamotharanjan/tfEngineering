MATCH (n)
WHERE n.id STARTS WITH 'demo-consumer-'
   OR (n:Module AND n.source CONTAINS 'modules/hot-demo')
DETACH DELETE n
WITH 1 AS _
MERGE (c1:Repository {id:'demo-consumer-payments'})
SET c1.role = 'downstream_consumer'
MERGE (c2:Repository {id:'demo-consumer-checkout'})
SET c2.role = 'downstream_consumer'
MERGE (st1:Stack {id:'demo-consumer-payments:main'})
SET st1.file = 'stacks/payments/main.tf'
MERGE (st2:Stack {id:'demo-consumer-checkout:main'})
SET st2.file = 'stacks/checkout/main.tf'
MERGE (c1)-[:HAS_STACK]->(st1)
MERGE (c2)-[:HAS_STACK]->(st2)
MERGE (mod:Module {source:'git::https://github.com/Dhamotharanjan/tfEngineering.git//modules/hot-demo'})
MERGE (st1)-[r1:REFERENCES_MODULE]->(mod)
SET r1.ref = 'demo-v1', r1.line = 2
MERGE (st2)-[r2:REFERENCES_MODULE]->(mod)
SET r2.ref = 'demo-v1', r2.line = 3
RETURN c1.id AS payments, c2.id AS checkout, mod.source AS module_source;
