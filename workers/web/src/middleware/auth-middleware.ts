import { NextResponse, type NextRequest } from "next/server";

import { getUserFromToken } from "@/data/users";

export async function authMiddleware(req: NextRequest) {

  const { pathname } = req.nextUrl;
  const user = await getUserFromToken(req.cookies.get("token")?.value, req.cookies.get("refreshToken")?.value);
  const isLoggedIn = !!user;

  console.log("=== DEBUG INFO ===");
  console.log("pathname:", pathname);
  console.log("isLoggedIn:", isLoggedIn);
  console.log("pathname.startsWith('/dashboard'):", pathname.startsWith("/dashboard"));
  console.log("!isLoggedIn && pathname.startsWith('/dashboard'):", !isLoggedIn && pathname.startsWith("/dashboard"));

  if (!isLoggedIn && pathname.startsWith("/dashboard")) {
    console.log(`Redirecting to login page due to unauthenticated request to ${pathname}`);
    return NextResponse.redirect(new URL("/auth/v3/login", req.url));
  }

  if (isLoggedIn && pathname === "/auth/v3/login") {
    console.log(`Redirecting to dashboard due to authenticated request to ${pathname}`);
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  console.log(`Auth middleware: Request to ${pathname} is ${isLoggedIn ? "" : "not"} authenticated.`);
  return NextResponse.next();
}