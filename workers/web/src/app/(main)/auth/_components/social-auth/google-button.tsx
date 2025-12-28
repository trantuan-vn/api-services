"use client";

import { useRouter } from "next/navigation";

import { siGoogle } from "simple-icons";
import { z } from "zod";

import { SimpleIcon } from "@/components/simple-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const GoogleOAuthSchema = z.object({
  url: z.string().url(),
});

export function GoogleButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  const router = useRouter();

  const handleGoogleLogin = async () => {
    try {
      const response = await fetch("https://api.unitoken.trade/auth/oauth/google/url");

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const validatedData = GoogleOAuthSchema.parse(data);

      router.push(validatedData.url);
    } catch (error) {
      console.error("Failed to get Google OAuth URL:", error);
    }
  };

  return (
    <Button variant="secondary" className={cn(className)} onClick={handleGoogleLogin} {...props}>
      <SimpleIcon icon={siGoogle} className="size-4" />
      Continue with Google
    </Button>
  );
}
