# Cortado Review

7 issue(s) found · 1 confirmed · 0 fixed · 0 verified · 243.9s

Classification: UI / AUTH · Size: normal · Model calls: 17 · Credits: 128.272

## [CONFIRMED] CRITICAL — Docs.tsx dereferences a property on an explicitly undefined value during component render (undefinedValue.property.nested.value), which thr…
File: `client/src/pages/Docs.tsx`
Confidence: 98%
Evidence: client/src/pages/Docs.tsx:311, client/src/pages/Docs.tsx:312
Reproduction:
```
grep -q 'undefinedValue.property.nested.value' client/src/pages/Docs.tsx && echo CORTADO_VULNERABLE && exit 1 || (echo CORTADO_SAFE; exit 0)
CORTADO_VULNERABLE
```
Repair: UNRESOLVED — fix not verified within 3 attempt(s)
Astra: uncertain / fix none / risk high / request_changes (60%)
Claim of an unguarded dereference of an explicitly undefined value in Docs.tsx render (lines 311-312) is plausible and marked confirmed with direct code evidence, but no runtime/test verification was supplied and repair is UNRESOLVED with no patch. Cannot approve: supply the code excerpt plus a reproduction (render Docs route) and a patch removing/guarding the debug statement.

## Static only (3)
- LOW — Auth heading applies bg-clip-text with a gradient but omits text-transparent, so the opaque foreground text color paints over the clipped gradient and the gradient effect never renders.
- LOW — Auth page imports useSearch (suggesting redirect-param handling) but the OAuth anchor hardcodes redirect=/home, so a user's intended pre-login destination is dropped after Google sign-in.
- MEDIUM — The Google OAuth entry link passes a 'redirect' query parameter to /auth/google; if the server-side handler does not whitelist-validate this parameter, an attacker can craft a login link that redirects victims to an attacker-controlled URL after authentication (open redirect / OAuth phishing vector).
