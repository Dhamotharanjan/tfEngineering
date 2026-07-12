resource "aws_lambda_function" "processor" {
  function_name = "processor"
  s3_bucket     = "app-bucket-old"
  handler       = "index.handler"
  runtime       = "nodejs18.x"
}
