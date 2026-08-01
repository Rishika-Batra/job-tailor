# Job Tailor 🎯

An AI-powered tool that analyzes how well a resume matches a job posting, then generates tailored resume bullet rewrites and a draft cover letter — grounded in the user's real experience, with a guardrail against fabricating skills or accomplishments they don't have.

**Live demo:** [[add your Vercel URL here]](https://job-tailor-two.vercel.app/)

## What it does

1. **Upload & Paste:** Upload your resume PDF and paste the target job description.
2. **Extraction:** The system locally extracts the text from your resume PDF.
3. **Gap Analysis:** Compares your resume against the JD requirements, scores the match, and identifies honest gaps.
4. **Tailoring:** Rewrites 3-5 resume bullets to mirror JD language *without* inventing experience you don't have.
5. **Cover Letter Draft:** Drafts a tailored cover letter referencing your real projects, skills, and the specific job requirements.

## Architecture

```text
       ┌──────────┐      ┌─────────────┐       ┌─────────────────┐
       │  React   │─────▶│ API Gateway │──────▶│  Ingest Lambda  │
       │ Frontend │      └─────────────┘       └─────────────────┘
       └──────────┘                                     │
                                            ┌───────────▼───────────┐
                                            │   S3 (raw resume/JD)  │
                                            │ DynamoDB (job status) │
                                            └───────────┬───────────┘
                                                        │
                                          ┌─────────────▼─────────────┐
                                          │ Step Functions State Mach │
                                          └─────────────┬─────────────┘
                                                        │
                      ┌─────────────────────────────────┼─────────────────────────────────┐
                      │                                 │                                 │
             ┌────────▼────────┐               ┌────────▼────────┐               ┌────────▼────────┐
             │ 1. Extract      │               │ 2. Analyze      │               │ 3. Generate     │
             │ (PDF to text)   │──────────────▶│ (Gap analysis)  │──────────────▶│ (Bullets +      │
             └────────┬────────┘               └────────┬────────┘               │  Cover Letter)  │
                      │                                 │                        └────────┬────────┘
                      ▼                                 ▼                                 ▼
                 ┌────────┐                        ┌────────┐                        ┌────────┐
                 │   S3   │                        │   S3   │                        │   S3   │
                 │(parsed)│                        │ (gaps) │                        │(final) │
                 └────────┘                        └────────┘                        └────────┘
                                                                                          │
                                                                                 ┌────────▼────────┐
                                                                                 │    DynamoDB     │
                                                                                 │status: complete │
                                                                                 └─────────────────┘
```

- **API Gateway & Ingest Lambda:** Handles the incoming requests from the frontend, securely stores raw inputs, and kicks off the async processing pipeline.
- **S3:** Serves as the central storage for raw PDFs, parsed text, intermediate JSON structures, and the final generated output.
- **DynamoDB:** Maintains job state (pending, complete, failed) enabling the frontend to poll for asynchronous completion.
- **Step Functions:** Orchestrates the multi-stage AI pipeline. Features include retries with exponential backoff and `Catch`-based error routing that correctly maps failures to specific statuses (e.g., failed extraction, failed analysis).
- **Terraform:** Used for Infrastructure as Code (IaC) to consistently provision all AWS resources.

## A real engineering decision worth mentioning

This project was originally designed around AWS Textract (for PDF extraction) and AWS Bedrock (using Claude, for LLM calls). However, development hit an account-tier restriction—both services require a fully billable AWS account, and this project was built on a free-credits account with no payment method attached.

Rather than add a payment method for a portfolio project, I implemented a pragmatic, zero-cost fix:
- **Textract** was replaced with **local PDF parsing** via the `pdf-parse` npm library. It achieves the same result with zero cost and no external dependencies.
- **Bedrock** was replaced with the **Groq API (Llama 3.3 70B)**. This required swapping the API call and auth mechanism while keeping the exact same JSON-schema prompting approach.

Crucially, **no architecture changes were required.** The Step Functions orchestration, error-handling design, and data flow remained completely identical. This is a deliberate demonstration of real infrastructure-constraint problem-solving, not a hidden workaround.

## Tech Stack

- **Backend:** AWS Lambda (Node.js 18 ESM), API Gateway, Step Functions, S3, DynamoDB, Terraform
- **AI:** Groq API (Llama 3.3 70B) for analysis and generation, `pdf-parse` for text extraction
- **Frontend:** React, TypeScript, Vite

## Project Structure

```text
.
├── frontend/          # React + Vite application
├── infra/             # Terraform infrastructure definitions
└── lambdas/
    ├── analyze/       # Performs gap analysis via Groq API
    ├── extract/       # Extracts raw text from PDF using pdf-parse
    ├── generate/      # Generates tailored bullets and cover letter
    ├── ingest/        # API entrypoint, saves raw files, triggers Step Functions
    ├── mark-failed/   # Updates DynamoDB on pipeline failures
    ├── history/       # Fetches historical jobs for a user
    └── status/        # Checks completion status of a running job
```

## Setup

### Prerequisites
- AWS CLI configured with active credentials
- Terraform 1.5+
- Node 18+
- A free Groq API key from [console.groq.com](https://console.groq.com) (no credit card required)

### Backend Deployment
1. Navigate to the infra directory:
   ```bash
   cd infra
   ```
2. Initialize and apply Terraform:
   ```bash
   terraform init
   terraform apply -var="groq_api_key=your_groq_api_key_here"
   ```
   *(Note the outputs for API Gateway URL and S3 bucket names once complete)*

### Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Create a `.env` file and add your API Gateway URL:
   ```env
   VITE_API_BASE_URL=your_api_gateway_invoke_url
   ```
3. Install dependencies and start the dev server:
   ```bash
   npm install
   npm run dev
   ```

