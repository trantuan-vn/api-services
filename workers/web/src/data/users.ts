import { verifyJWT } from "@/lib/utils";

export interface User {
  id: string;
  identifier: string;
}

// Helper function to process token verification
const verifyToken = async (t: string): Promise<User | null> => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error("JWT_SECRET is not defined in environment variables");
    return null;
  }

  const result = await verifyJWT(t, jwtSecret);
  if (!result.ok || !result.payload) {
    console.error(result.error ?? "Token verification failed");
    return null;
  }

  const { sub, identifier } = result.payload;
  if (!sub || !identifier) {
    console.error("Missing required payload fields");
    return null;
  }

  return { id: sub, identifier };
};

export async function getUserFromToken(token?: string, refreshToken?: string): Promise<User | null> {

  if (!token && !refreshToken) {
    console.error("Both token and refresh token are missing");
    return null;
  }

  // Try token first, then refreshToken if token fails
  if (token) {
    const user = await verifyToken(token);
    if (user) return user;
  }

  if (refreshToken) {
    const user = await verifyToken(refreshToken);
    if (user) return user;
  }

  return null;
}
