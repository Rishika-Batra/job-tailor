# Data archives for new lambdas
data "archive_file" "extract_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/extract"
  output_path = "${path.module}/extract_lambda.zip"
}

data "archive_file" "analyze_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/analyze"
  output_path = "${path.module}/analyze_lambda.zip"
}

data "archive_file" "generate_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/generate"
  output_path = "${path.module}/generate_lambda.zip"
}

data "archive_file" "mark_failed_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/mark-failed"
  output_path = "${path.module}/mark_failed_lambda.zip"
}

# New lambdas
resource "aws_lambda_function" "extract" {
  filename         = data.archive_file.extract_zip.output_path
  function_name    = "job-tailor-extract"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.extract_zip.output_base64sha256
  runtime          = "nodejs18.x"
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      BUCKET = aws_s3_bucket.documents.bucket
    }
  }
}

resource "aws_lambda_function" "analyze" {
  filename         = data.archive_file.analyze_zip.output_path
  function_name    = "job-tailor-analyze"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.analyze_zip.output_base64sha256
  runtime          = "nodejs18.x"
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      BUCKET       = aws_s3_bucket.documents.bucket
      GROQ_API_KEY = var.groq_api_key
    }
  }
}

resource "aws_lambda_function" "generate" {
  filename         = data.archive_file.generate_zip.output_path
  function_name    = "job-tailor-generate"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.generate_zip.output_base64sha256
  runtime          = "nodejs18.x"
  timeout          = 30
  memory_size      = 256
  environment {
    variables = {
      BUCKET       = aws_s3_bucket.documents.bucket
      GROQ_API_KEY = var.groq_api_key
      TABLE        = aws_dynamodb_table.jobs.name
    }
  }
}

resource "aws_lambda_function" "mark_failed" {
  filename         = data.archive_file.mark_failed_zip.output_path
  function_name    = "job-tailor-mark-failed"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.mark_failed_zip.output_base64sha256
  runtime          = "nodejs18.x"

  environment {
    variables = {
      TABLE = aws_dynamodb_table.jobs.name
    }
  }
}

# IAM Role for Step Functions
resource "aws_iam_role" "sfn_exec" {
  name = "job-tailor-sfn-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "states.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_policy" "sfn_invoke_lambda" {
  name        = "job-tailor-sfn-invoke-policy"
  description = "Allow Step Functions to invoke lambdas"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = [
          aws_lambda_function.extract.arn,
          aws_lambda_function.analyze.arn,
          aws_lambda_function.generate.arn,
          aws_lambda_function.mark_failed.arn
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "sfn_invoke_attach" {
  role       = aws_iam_role.sfn_exec.name
  policy_arn = aws_iam_policy.sfn_invoke_lambda.arn
}

# Step Functions State Machine
resource "aws_sfn_state_machine" "processing_pipeline" {
  name     = "job-tailor-processing"
  role_arn = aws_iam_role.sfn_exec.arn

  definition = jsonencode({
    Comment = "Job processing pipeline"
    StartAt = "Extract"
    States = {
      Extract = {
        Type     = "Task"
        Resource = aws_lambda_function.extract.arn
        Retry = [
          {
            ErrorEquals     = ["States.ALL"]
            IntervalSeconds = 2
            MaxAttempts     = 3
            BackoffRate     = 2
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            Next        = "SetFailedExtraction"
            ResultPath  = "$.error-info"
          }
        ]
        Next = "Analyze"
      }
      SetFailedExtraction = {
        Type = "Pass"
        Result = "failed_extraction"
        ResultPath = "$.status"
        Next = "MarkFailed"
      }
      Analyze = {
        Type     = "Task"
        Resource = aws_lambda_function.analyze.arn
        Retry = [
          {
            ErrorEquals     = ["States.ALL"]
            IntervalSeconds = 2
            MaxAttempts     = 3
            BackoffRate     = 2
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            Next        = "SetFailedAnalysis"
            ResultPath  = "$.error-info"
          }
        ]
        Next = "Generate"
      }
      SetFailedAnalysis = {
        Type = "Pass"
        Result = "failed_analysis"
        ResultPath = "$.status"
        Next = "MarkFailed"
      }
      Generate = {
        Type     = "Task"
        Resource = aws_lambda_function.generate.arn
        Retry = [
          {
            ErrorEquals     = ["States.ALL"]
            IntervalSeconds = 2
            MaxAttempts     = 3
            BackoffRate     = 2
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            Next        = "SetFailedGeneration"
            ResultPath  = "$.error-info"
          }
        ]
        End = true
      }
      SetFailedGeneration = {
        Type = "Pass"
        Result = "failed_generation"
        ResultPath = "$.status"
        Next = "MarkFailed"
      }
      MarkFailed = {
        Type     = "Task"
        Resource = aws_lambda_function.mark_failed.arn
        End      = true
      }
    }
  })
}

# Grant Ingest Lambda permission to start execution
resource "aws_iam_role_policy" "ingest_sfn_start" {
  name = "job-tailor-ingest-sfn-start"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "states:StartExecution"
        Resource = aws_sfn_state_machine.processing_pipeline.arn
      }
    ]
  })
}
