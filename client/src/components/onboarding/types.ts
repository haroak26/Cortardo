export type OnboardingClientSession = {
  currentStep: string;
  profile: { displayName: string };
  workspace: { name: string; id: string | null };
  displayNameStatus?: string;
  workspaceStatus?: string;
};
