export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Google OAuth login URL — redirects to server-side OAuth initiation
export const getLoginUrl = () => {
  return `/api/oauth/google/login`;
};
