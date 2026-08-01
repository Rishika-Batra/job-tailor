# job-tailor

Job Tailor is an application with a serverless AWS backend and a React frontend.

## Directory Structure
- `infra/`: Terraform configuration for setting up AWS infrastructure (S3, DynamoDB, IAM).
- `lambdas/`: Contains AWS Lambda functions.
  - `ingest/`
  - `extract/`
  - `analyze/`
  - `generate/`
  - `status/`
- `frontend/`: React + Vite + TypeScript web application.
