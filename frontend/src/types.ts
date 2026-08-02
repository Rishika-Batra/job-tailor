export type Gap = { requirement: string; note: string }
export type Match = { requirement: string; evidence_from_resume: string }
export type BulletRewrite = { original_bullet: string; rewritten_bullet: string; why: string }

export type AnalysisResult = {
  match_score?: number
  must_have_requirements?: string[]
  nice_to_have_requirements?: string[]
  matches?: Match[]
  gaps?: Gap[]
  seniority_signal?: string
  bullet_rewrites?: BulletRewrite[]
  cover_letter?: string
  cover_letter_paragraphs?: string[]
}

export type StatusResponse =
  | { status: 'complete'; result: AnalysisResult }
  | { status: string }

export type HistoryJob = {
  jobId: string
  matchScore: number | null
  completedAt: string | null
  jdSnippet: string | null
}
