"use client";

import { useRouter } from "next/navigation";

import { siGithub } from "simple-icons";
import { z } from "zod";

import { SimpleIcon } from "@/components/simple-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const GithubOAuthSchema = z.object({
  url: z.string().url(),
});

export function GithubButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  const router = useRouter();

  const handleGithubLogin = async () => {
    try {
      const response = await fetch("https://api.unitoken.trade/auth/oauth/github/url");

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const validatedData = GithubOAuthSchema.parse(data);

      router.push(validatedData.url);
    } catch (error) {
      console.error("Failed to get Facebook OAuth URL:", error);
    }
  };

  return (
    <Button variant="secondary" className={cn(className)} onClick={handleGithubLogin} {...props}>
      <SimpleIcon icon={siGithub} className="size-4" />
      Continue with Github
    </Button>
  );
}
