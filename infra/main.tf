provider "aws" {
  region = "us-east-1"
}

variable "groq_api_key" {
  type      = string
  sensitive = true
}

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "documents" {
  bucket = "job-tailor-docs-${random_id.bucket_suffix.hex}"
}

resource "aws_dynamodb_table" "jobs" {
  name         = "job-tailor-jobs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "jobId"

  attribute {
    name = "jobId"
    type = "S"
  }
}

# IAM Role for Lambda Functions
resource "aws_iam_role" "lambda_exec" {
  name = "job-tailor-lambda-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

# Add standard Lambda basic execution policy for CloudWatch logs
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# IAM Policy to allow Lambda to access S3 and DynamoDB
resource "aws_iam_policy" "lambda_s3_dynamo" {
  name        = "job-tailor-lambda-policy"
  description = "Allow Lambda to access job-tailor S3 and DynamoDB"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.documents.arn,
          "${aws_s3_bucket.documents.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Scan",
          "dynamodb:Query"
        ]
        Resource = aws_dynamodb_table.jobs.arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_s3_dynamo_attach" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = aws_iam_policy.lambda_s3_dynamo.arn
}

data "archive_file" "ingest_lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/ingest"
  output_path = "${path.module}/ingest_lambda.zip"
}

resource "aws_lambda_function" "ingest" {
  filename         = data.archive_file.ingest_lambda_zip.output_path
  function_name    = "job-tailor-ingest"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.ingest_lambda_zip.output_base64sha256
  runtime          = "nodejs18.x"

  environment {
    variables = {
      BUCKET = aws_s3_bucket.documents.bucket
      TABLE  = aws_dynamodb_table.jobs.name
      STATE_MACHINE_ARN = aws_sfn_state_machine.processing_pipeline.arn
    }
  }
}

resource "aws_apigatewayv2_api" "http_api" {
  name          = "job-tailor-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http_api.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_integration" "lambda_integration" {
  api_id             = aws_apigatewayv2_api.http_api.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.ingest.invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_route" "post_submit" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /submit"
  target    = "integrations/${aws_apigatewayv2_integration.lambda_integration.id}"
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingest.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

# ---- Status Lambda ----
data "archive_file" "status_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/status"
  output_path = "${path.module}/status_lambda.zip"
}

resource "aws_lambda_function" "status" {
  filename         = data.archive_file.status_zip.output_path
  function_name    = "job-tailor-status"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.status_zip.output_base64sha256
  runtime          = "nodejs18.x"
  timeout          = 15
  memory_size      = 128
  environment {
    variables = {
      BUCKET = aws_s3_bucket.documents.bucket
      TABLE  = aws_dynamodb_table.jobs.name
    }
  }
}

resource "aws_apigatewayv2_integration" "status_integration" {
  api_id             = aws_apigatewayv2_api.http_api.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.status.invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_route" "get_status" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "GET /status/{jobId}"
  target    = "integrations/${aws_apigatewayv2_integration.status_integration.id}"
}

resource "aws_lambda_permission" "apigw_status" {
  statement_id  = "AllowAPIGatewayInvokeStatus"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.status.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

# ---- History Lambda ----
data "archive_file" "history_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/history"
  output_path = "${path.module}/history_lambda.zip"
}

resource "aws_lambda_function" "history" {
  filename         = data.archive_file.history_zip.output_path
  function_name    = "job-tailor-history"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.history_zip.output_base64sha256
  runtime          = "nodejs18.x"
  timeout          = 15
  memory_size      = 128
  environment {
    variables = {
      TABLE = aws_dynamodb_table.jobs.name
    }
  }
}

resource "aws_apigatewayv2_integration" "history_integration" {
  api_id             = aws_apigatewayv2_api.http_api.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.history.invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_route" "get_history" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "GET /history"
  target    = "integrations/${aws_apigatewayv2_integration.history_integration.id}"
}

resource "aws_lambda_permission" "apigw_history" {
  statement_id  = "AllowAPIGatewayInvokeHistory"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.history.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}
