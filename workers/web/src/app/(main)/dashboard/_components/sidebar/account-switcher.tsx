"use client";

import { useState } from "react";

import Link from "next/link";

import { BadgeCheck, Bell, CreditCard, LogOut, LogIn, UserPen } from "lucide-react";
import { useDisconnect, useAccount } from 'wagmi';

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { User } from "@/data/users";

export function AccountSwitcher({
  user,
}: {
  readonly user: User | null;
}) {
  const { disconnect } = useDisconnect();
  const { isConnected } = useAccount();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Alternative approach: Sử dụng useEffect để theo dõi trạng thái disconnect
  const handleLogoutWithCheck = async () => {
    if (isLoggingOut) return;

    setIsLoggingOut(true);

    try {
      // Disconnect wallet
      disconnect();

      // Đợi cho đến khi wallet thực sự disconnected hoặc timeout
      let attempts = 0;
      const maxAttempts = 10; // 2 seconds total (200ms * 10)

      const checkDisconnected = () => {
        return new Promise((resolve) => {
          const interval = setInterval(() => {
            attempts++;
            if (!isConnected || attempts >= maxAttempts) {
              clearInterval(interval);
              resolve(true);
            }
          }, 200);
        });
      };

      await checkDisconnected();

      // Call API logout
      const response = await fetch("https://api.unitoken.trade/auth/profile/logout", {
        method: "POST",
        credentials: "include",
      });

      if (response.ok) {
        // Handle successful logout (e.g., redirect or update state)
        window.location.href = "/"; // Redirect to login page
      } else {
        console.error("Logout failed");
      }

    } catch (error) {
      console.error("Error during logout:", error);
      window.location.href = "/";
    } finally {
      setIsLoggingOut(false);
    }
  };

  const menuItems = user
    ? [
        { title: "Account", icon: BadgeCheck, url: "/account" },
        { title: "Billing", icon: CreditCard, url: "/billing" },
        { title: "Notifications", icon: Bell, url: "/notifications" },
        { title: "Log out", icon: LogOut, url: "#", onClick: isLoggingOut ? undefined : handleLogoutWithCheck },
      ]
    : [{ title: "Log In", icon: LogIn, url: "/" }];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" disabled={isLoggingOut}>
          <UserPen />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="min-w-56 space-y-1 rounded-lg"
        side="bottom"
        align="end"
        sideOffset={4}
      >
        {user ? (
          <>
            <DropdownMenuGroup>
              {menuItems.slice(0, -1).map((item, index) => (
                <DropdownMenuItem key={index}>
                  <Link href={item.url} className="flex items-center w-full">
                    <item.icon className="mr-2 h-4 w-4" />
                    <span>{item.title}</span>
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={isLoggingOut}>
              <button
                onClick={menuItems[menuItems.length - 1].onClick}
                className="flex items-center w-full"
                disabled={isLoggingOut}
              >
                {(() => {
                  const Icon = menuItems[menuItems.length - 1].icon;
                  return <Icon className="mr-2 h-4 w-4" />;
                })()}
                <span>
                  {isLoggingOut ? "Logging out..." : menuItems[menuItems.length - 1].title}
                </span>
              </button>
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem>
            <Link href={menuItems[0].url} className="flex items-center w-full">
              {(() => {
                const Icon = menuItems[0].icon;
                return <Icon className="mr-2 h-4 w-4" />;
              })()}
              <span>{menuItems[0].title}</span>
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}