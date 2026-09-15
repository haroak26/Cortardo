/**
 * Minimal, self-contained PR6-style fixture used by the 3.1 engine golden
 * replay. It plants the same three defects the live PR6 E2E proved:
 *  1. an undefined dereference that crashes /docs on render,
 *  2. an index filter that removes the featured Max tier on /pricing,
 *  3. a navigation regression that sends "Sign up with Email" to "/" .
 */
import type { ChangedFileInput } from "../../../src/v3/types.ts";

export const docsContent = `import { useState } from "react";

export default function Docs() {
  const [tab] = useState("install");
  const undefinedValue = undefined as any;
  console.log(undefinedValue.property.nested.value);

  return (
    <div>
      <h1>Docs</h1>
      <p>{tab}</p>
    </div>
  );
}
`;

export const docsPatch = `@@ -1,4 +1,6 @@
 import { useState } from "react";
 
 export default function Docs() {
   const [tab] = useState("install");
+  const undefinedValue = undefined as any;
+  console.log(undefinedValue.property.nested.value);
 
   return (
`;

export const pricingContent = `const tiers = [
  { name: "Free", popular: false, features: ["a"] },
  { name: "Max", popular: true, features: ["b"] },
  { name: "Enterprise", popular: false, features: ["c"] },
];

export default function Pricing() {
  return (
    <div>
      {tiers.filter((_, i) => i !== 1).map((tier, index) => {
        return (
          <div key={index}>
            {tier.name}
            {tier.popular && <span>Most Popular</span>}
          </div>
        );
      })}
    </div>
  );
}
`;

export const pricingPatch = `@@ -1,5 +1,13 @@
 const tiers = [
   { name: "Free", popular: false, features: ["a"] },
+  { name: "Max", popular: true, features: ["b"] },
   { name: "Enterprise", popular: false, features: ["c"] },
 ];
 
 export default function Pricing() {
   return (
     <div>
+      {tiers.filter((_, i) => i !== 1).map((tier, index) => {
+        return (
+          <div key={index}>
+            {tier.name}
+            {tier.popular && <span>Most Popular</span>}
+          </div>
+        );
+      })}
     </div>
   );
 }
`;

export const authContent = `import { useLocation } from "wouter";

export default function Auth() {
  const [, setLocation] = useLocation();
  return (
    <div>
      <button
        onClick={() => setLocation("/")}
      >
        Sign up with Email
      </button>
    </div>
  );
}
`;

export const authPatch = `@@ -5,7 +5,7 @@
   return (
     <div>
       <button
-        onClick={() => setLocation("/auth/register")}
+        onClick={() => setLocation("/")}
       >
         Sign up with Email
       </button>
`;

export const pr6Files: ChangedFileInput[] = [
  { path: "client/src/pages/Docs.tsx", status: "modified", patch: docsPatch, content: docsContent, additions: 2, deletions: 0 },
  { path: "client/src/pages/Pricing.tsx", status: "modified", patch: pricingPatch, content: pricingContent, additions: 2, deletions: 0 },
  { path: "client/src/pages/Auth.tsx", status: "modified", patch: authPatch, content: authContent, additions: 1, deletions: 1 },
];

export const pr6ExpectedFiles: Record<string, string> = {
  "client/src/pages/Docs.tsx": docsContent,
  "client/src/pages/Pricing.tsx": pricingContent,
  "client/src/pages/Auth.tsx": authContent,
};
