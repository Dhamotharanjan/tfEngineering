import os
import sys
from pathlib import Path
import boto3
from botocore.client import Config

MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "http://minio:9000")
MINIO_ACCESS = os.environ.get("MINIO_ACCESS", "minioadmin")
MINIO_SECRET = os.environ.get("MINIO_SECRET", "minioadmin")
BUCKET = os.environ.get("MINIO_BUCKET", "tfengineering-test")

def main():
    # boto3 needs endpoint without http scheme for client; use config
    endpoint = MINIO_ENDPOINT
    if endpoint.startswith("http"):
        endpoint_url = endpoint
    else:
        endpoint_url = f"http://{endpoint}"

    s3 = boto3.resource(
        's3',
        endpoint_url=endpoint_url,
        aws_access_key_id=MINIO_ACCESS,
        aws_secret_access_key=MINIO_SECRET,
        config=Config(signature_version='s3v4'),
        region_name='us-east-1'
    )

    # create bucket if not exists
    try:
        s3.create_bucket(Bucket=BUCKET)
    except Exception:
        pass

    # upload a small test object
    key = 'test/object.txt'
    body = b'This is a MinIO test object for TFEngineering.'
    s3.Object(BUCKET, key).put(Body=body)
    print(f"Uploaded {key} to bucket {BUCKET} at {endpoint_url}")

if __name__ == '__main__':
    main()
