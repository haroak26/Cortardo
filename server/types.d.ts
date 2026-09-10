import "express-session";

declare module "express-session" {
  interface SessionData {
    oauthFlow?: { isNewUser: boolean; provider: string };
    oauthState?: string;
    isAdmin?: boolean;
    adminChallengeId?: string;
  }
}

declare module "qrcode" {
  export function toDataURL(text: string, options?: { width?: number; margin?: number }): Promise<string>;
}
