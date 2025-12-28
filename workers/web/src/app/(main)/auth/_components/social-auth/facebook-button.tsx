"use client";

import { useRouter } from "next/navigation";

import { siFacebook } from "simple-icons";
import { z } from "zod";

import { SimpleIcon } from "@/components/simple-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FacebookOAuthSchema = z.object({
  url: z.string().url(),
});

export function FacebookButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  const router = useRouter();

  const handleFacebookLogin = async () => {
    try {
      const response = await fetch("https://api.unitoken.trade/auth/oauth/facebook/url");

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const validatedData = FacebookOAuthSchema.parse(data);

      router.push(validatedData.url);
    } catch (error) {
      console.error("Failed to get Facebook OAuth URL:", error);
    }
  };

  return (
    <Button variant="secondary" className={cn(className)} onClick={handleFacebookLogin} {...props}>
      <SimpleIcon icon={siFacebook} className="size-4" />
      Continue with Facebook
    </Button>
  );
}
