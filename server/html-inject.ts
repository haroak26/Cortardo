function getPath(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url;
  }
}

export function injectMeta(html: string, requestUrl: string): string {
  const path = getPath(requestUrl);

  // Public user pages (ticket tracking, contact, notice board) — do not index
  if (path.startsWith("/p/")) {
    html = html.replace(
      "</head>",
      '  <meta name="robots" content="noindex, nofollow">\n</head>',
    );
  }

  // Landing page — rich structured data for search engines & AI models
  if (path === "/") {
    const jsonLd = `
<script type="application/ld+json">
[
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "Cortardo",
    "applicationCategory": "DeveloperApplication",
    "operatingSystem": "Web",
    "description": "Cortardo is an AI code review tool that catches bugs, security issues, and style problems in every pull request. Review, collaborate, and ship with confidence.",
    "url": "https://cortardo.com/",
    "sameAs": [
      "https://twitter.com/cortardo",
      "https://github.com/cortardo"
    ],
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD"
    },
    "featureList": [
      "AI-powered code review with Cortardo Agent",
      "Pull request analysis on every push",
      "Security vulnerability and bug detection",
      "Inline suggestions and one-click fixes",
      "Style and best-practice enforcement",
      "PR summaries and walkthroughs",
      "Team workspaces"
    ],
    "screenshot": "https://cortardo.com/og-image.png"
  },
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Cortardo",
    "url": "https://cortardo.com/",
    "logo": "https://cortardo.com/og-image.png",
    "description": "Review. Merge. Ship.",
    "sameAs": [
      "https://twitter.com/cortardo",
      "https://github.com/cortardo"
    ]
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Cortardo",
    "url": "https://cortardo.com/",
    "description": "Cortardo is an AI code review tool that catches bugs, security issues, and style problems in every pull request. Review, collaborate, and ship with confidence.",
    "inLanguage": "en-US"
  }
]
</script>

<script type="text/markdown" aria-hidden="true">
# Cortardo — Review. Merge. Ship.

Cortardo is an AI code review tool that helps teams ship better code, faster. Key features include:

## Core Features
- **Cortardo Agent**: Reviews every pull request and leaves line-by-line feedback from a plain-English ruleset
- **Deep Analysis**: Catches bugs, security vulnerabilities, and performance issues before merge
- **Inline Fixes**: One-click suggestions that apply directly to your branch
- **PR Summaries**: Instant walkthroughs of what changed and why it matters
- **Style Enforcement**: Keeps your codebase consistent with your team's conventions
- **Team Workspaces**: Collaborate with your team in shared workspaces

## Links
- Website: https://cortardo.com/
- Twitter: https://twitter.com/cortardo
- GitHub: https://github.com/cortardo
</script>`;

    html = html.replace("</head>", `${jsonLd}\n</head>`);
  }

  return html;
}
