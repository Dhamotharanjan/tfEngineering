import os
import json
from pymilvus import connections, utility, FieldSchema, CollectionSchema, DataType, Collection

MILVUS_HOST = os.environ.get('MILVUS_HOST', 'milvus')
MILVUS_PORT = os.environ.get('MILVUS_PORT', '19530')

def main():
    connections.connect(host=MILVUS_HOST, port=MILVUS_PORT)
    collection_name = 'tfengineering_test'
    if utility.has_collection(collection_name):
        utility.drop_collection(collection_name)

    fields = [
        FieldSchema(name='id', dtype=DataType.INT64, is_primary=True),
        FieldSchema(name='embedding', dtype=DataType.FLOAT_VECTOR, dim=8),
    ]
    schema = CollectionSchema(fields, description='Test embeddings')
    coll = Collection(collection_name, schema)

    # upsert dummy vectors
    ids = [1, 2, 3]
    embeddings = [[0.1 * i for _ in range(8)] for i in range(1, 4)]
    coll.insert([ids, embeddings])
    coll.load()
    print(f'Inserted {len(ids)} dummy vectors into {collection_name}')

if __name__ == '__main__':
    main()
