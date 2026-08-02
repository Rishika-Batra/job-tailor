data "archive_file" "gap_trends_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/gap-trends"
  output_path = "${path.module}/gap_trends_lambda.zip"
}

resource "aws_lambda_function" "gap_trends" {
  function_name    = "job-tailor-gap-trends"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  runtime          = "nodejs18.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.gap_trends_zip.output_path
  source_code_hash = data.archive_file.gap_trends_zip.output_base64sha256

  environment {
    variables = {
      BUCKET = aws_s3_bucket.documents.id
      TABLE  = aws_dynamodb_table.jobs.name
    }
  }
}

resource "aws_lambda_permission" "apigw_gap_trends" {
  statement_id  = "AllowAPIGatewayInvokeGapTrends"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.gap_trends.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_apigatewayv2_integration" "gap_trends_integration" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.gap_trends.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_gap_trends" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "GET /gap-trends"
  target             = "integrations/${aws_apigatewayv2_integration.gap_trends_integration.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_authorizer.id
}
