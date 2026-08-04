import { describe, it, expect } from 'vitest';

// Mirrors the isProjectLink logic from lambdas/render-resume-pdf/index.mjs.
// Decides whether a link points at a specific GitHub repo (which belongs
// next to that project) vs. a profile-level link (which belongs in the header).
function isProjectLink(l) {
  const normalized = l.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const githubRepoMatch = normalized.match(/^github\.com\/[^\/]+\/[^\/]+/);
  return !!githubRepoMatch;
}

// Mirrors the repo-URL merge logic from lambdas/generate-ats-resume/index.mjs.
// Matches LLM-returned project names back to real selected-repo URLs by name,
// case-insensitively, so we never trust the LLM to reproduce a URL verbatim.
function mergeRepoUrls(projects, selectedRepos) {
  const repoByName = Object.fromEntries(
    (selectedRepos || []).map(r => [(r.name || '').toLowerCase(), r])
  );
  return (projects || []).map(p => {
    const match = repoByName[(p.name || '').toLowerCase()];
    return match ? { ...p, url: match.url || match.html_url || p.url } : p;
  });
}

describe('isProjectLink', () => {
  it('identifies a GitHub repo link', () => {
    expect(isProjectLink('github.com/Rishika-Batra/sentinel-moderate')).toBe(true);
  });

  it('identifies a GitHub repo link with https prefix', () => {
    expect(isProjectLink('https://github.com/Rishika-Batra/job-tailor')).toBe(true);
  });

  it('does NOT flag a bare GitHub profile link', () => {
    expect(isProjectLink('github.com/Rishika-Batra')).toBe(false);
  });

  it('does NOT flag a LinkedIn link', () => {
    expect(isProjectLink('linkedin.com/in/rishika-batra-dev/')).toBe(false);
  });

  it('does NOT flag a LeetCode link', () => {
    expect(isProjectLink('leetcode.com/u/Rishika_Batra_21/')).toBe(false);
  });

  it('handles www. prefix', () => {
    expect(isProjectLink('https://www.github.com/Rishika-Batra/job-tailor')).toBe(true);
  });
});

describe('mergeRepoUrls', () => {
  const selectedRepos = [
    { name: 'sentinel-moderate', url: 'https://github.com/Rishika-Batra/sentinel-moderate' },
    { name: 'Job-Tracker', html_url: 'https://github.com/Rishika-Batra/Job-Tracker' },
  ];

  it('merges the real URL in by matching name case-insensitively', () => {
    const projects = [{ name: 'Sentinel-Moderate', url: null }];
    const result = mergeRepoUrls(projects, selectedRepos);
    expect(result[0].url).toBe('https://github.com/Rishika-Batra/sentinel-moderate');
  });

  it('falls back to html_url when url is not present', () => {
    const projects = [{ name: 'job-tracker', url: null }];
    const result = mergeRepoUrls(projects, selectedRepos);
    expect(result[0].url).toBe('https://github.com/Rishika-Batra/Job-Tracker');
  });

  it('leaves non-matching projects untouched', () => {
    const projects = [{ name: 'unrelated-project', url: 'https://original.example.com' }];
    const result = mergeRepoUrls(projects, selectedRepos);
    expect(result[0].url).toBe('https://original.example.com');
  });

  it('handles an empty selectedRepos list without throwing', () => {
    const projects = [{ name: 'anything', url: 'https://original.example.com' }];
    const result = mergeRepoUrls(projects, []);
    expect(result[0].url).toBe('https://original.example.com');
  });
});
