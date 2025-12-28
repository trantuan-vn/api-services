"use client";
import { useState, useCallback, useEffect, useRef } from "react";

import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

// Custom debounce function
function debounce<T extends(...args: any[]) => void>(func: T, wait: number): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      func(...args);
    }, wait);
  };
}

// Schema for form validation
const FormSchema = z.object({
  username: z
    .string()
    .min(1, { message: "Please enter your email or phone number." })
    .refine(
      (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || /^\+?\d{10,15}$/.test(value),
      { message: "Please enter a valid email or phone number." }
    ),
  remember: z.boolean().optional(),
});

// Interface for API error response
interface ErrorResponse {
  error?: string;
}

export function LoginForm() {
  const [showOtpPopup, setShowOtpPopup] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const isMounted = useRef(true);
  const router = useRouter();

  // Form setup with react-hook-form
  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      username: "",
      remember: false,
    },
    mode: "onChange",
  });

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Helper function to extract error message
  const getErrorMessage = async (response: Response): Promise<string> => {
    try {
      const errorData: ErrorResponse = await response.json();
      return errorData.error ?? "An unexpected error occurred";
    } catch {
      return "An unexpected error occurred";
    }
  };

  // Validate OTP
  const validateOtp = (otp: string): boolean => {
    if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
      toast.error("Please enter a valid 6-digit OTP");
      return false;
    }
    return true;
  };

  // Handle OTP verification
  const handleOtpVerify = useCallback(async () => {
    if (!isMounted.current || !validateOtp(otp)) return;

    setIsLoading(true);
    try {
      const response = await fetch("https://api.unitoken.trade/auth/otp/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identifier: identifier.trim(),
          otp,
        }),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      setShowOtpPopup(false);
      setOtp("");
      form.reset();
      router.push("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid OTP. Please try again.");
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, [otp, identifier, form]);

  // Handle form submission
  const onSubmit = useCallback(
    async (data: z.infer<typeof FormSchema>) => {
      if (!isMounted.current) return;
      setIsLoading(true);
      try {
        const requestResponse = await fetch("https://api.unitoken.trade/auth/otp/request", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            identifier: data.username.trim(),
          }),
        });

        if (!requestResponse.ok) {
          const errorMessage = await getErrorMessage(requestResponse);
          throw new Error(errorMessage);
        }

        if (isMounted.current) {
          setIdentifier(data.username.trim());
          setShowOtpPopup(true);
          toast.success("OTP has been sent to your email/phone");
        }
      } catch (error) {
        if (isMounted.current) {
          toast.error(error instanceof Error ? error.message : "Failed to send OTP. Please try again.");
        }
      } finally {
        if (isMounted.current) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  // Debounced OTP input handler
  const handleOtpChange = useCallback(
    debounce((value: string) => {
      if (isMounted.current) {
        const numericValue = value.replace(/\D/g, "").slice(0, 6);
        setOtp(numericValue);
      }
    }, 300),
    []
  );

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="username">Email or Phone Number</FormLabel>
              <FormControl>
                <Input
                  id="username"
                  type="text"
                  placeholder="you@example.com or +84..."
                  autoComplete="username"
                  aria-required="true"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="remember"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center">
              <FormControl>
                <Checkbox
                  id="login-remember"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  className="size-4"
                  aria-label="Remember me for 30 days"
                />
              </FormControl>
              <FormLabel htmlFor="login-remember" className="text-muted-foreground ml-1 text-sm font-medium">
                Remember me for 30 days
              </FormLabel>
            </FormItem>
          )}
        />
        <Button className="w-full" type="submit" disabled={isLoading || !form.formState.isValid}>
          {isLoading ? "Sending OTP..." : "Login"}
        </Button>
      </form>

      {/* OTP Dialog */}
      <Dialog
        open={showOtpPopup}
        onOpenChange={(open) => {
          if (!open) {
            setOtp("");
          }
          setShowOtpPopup(open);
        }}
      >
        <DialogContent className="sm:max-w-md" aria-describedby="otp-dialog-description">
          <DialogHeader>
            <DialogTitle>Enter OTP Code</DialogTitle>
            <div id="otp-dialog-description" className="text-sm text-muted-foreground">
              We have sent a 6-digit verification code to: <strong>{identifier}</strong>
            </div>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <FormLabel htmlFor="otp-input">OTP Code</FormLabel>
              <Input
                id="otp-input"
                type="text"
                placeholder="Enter 6-digit code"
                value={otp}
                onChange={(e) => handleOtpChange(e.target.value)}
                maxLength={6}
                inputMode="numeric"
                pattern="[0-9]*"
                className="text-center text-lg font-mono tracking-widest"
                aria-required="true"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowOtpPopup(false);
                  setOtp("");
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={handleOtpVerify}
                disabled={isLoading || otp.length !== 6}
              >
                {isLoading ? "Verifying..." : "Verify OTP"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </FormProvider>
  );
}