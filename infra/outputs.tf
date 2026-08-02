output "s3_bucket_name" {
  description = "The name of the S3 bucket for storing documents"
  value       = aws_s3_bucket.documents.bucket
}

output "dynamodb_table_name" {
  description = "The name of the DynamoDB table for jobs"
  value       = aws_dynamodb_table.jobs.name
}

output "lambda_execution_role_arn" {
  description = "The ARN of the Lambda execution role"
  value       = aws_iam_role.lambda_exec.arn
}

output "api_gateway_invoke_url" {
  description = "The HTTP API Gateway URL"
  value       = aws_apigatewayv2_api.http_api.api_endpoint
}

output "state_machine_arn" {
  description = "The ARN of the Step Functions State Machine"
  value       = aws_sfn_state_machine.processing_pipeline.arn
}

output "cognito_user_pool_id" {
  description = "The ID of the Cognito User Pool"
  value       = aws_cognito_user_pool.pool.id
}

output "cognito_client_id" {
  description = "The ID of the Cognito User Pool Client"
  value       = aws_cognito_user_pool_client.client.id
}

output "cognito_region" {
  description = "The region of the Cognito User Pool"
  value       = "us-east-1"
}
