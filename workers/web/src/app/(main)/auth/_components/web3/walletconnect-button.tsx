"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { SiweMessage } from "siwe";
import { toast } from "sonner";
import { useConnect, useSignMessage, useAccount, useChainId } from "wagmi";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NonceSchema = z.object({
  nonce: z.string().min(1).regex(/^[a-zA-Z0-9]+$/, "Nonce chỉ được chứa chữ cái và số"),
});

export function WalletConnectButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const chainId = useChainId() || 1;
  const [isSigning, setIsSigning] = useState(false);

  useEffect(() => {
    if (isConnected && address) {
      console.log("Đã kết nối địa chỉ:", address);
      handlePostConnection();
    }
  }, [isConnected, address]);

  const handlePostConnection = async () => {
    setIsSigning(true);

    try {
      // Thông báo cho người dùng biết đang lấy thông tin xác thực
      toast.info("Đang chuẩn bị thông tin xác thực...");

      const nonceResponse = await fetch("https://api.unitoken.trade/dashboard/auth/wallet/nonce", {
        method: "GET",
        credentials: "include",
      });

      if (!nonceResponse.ok) {
        const errorText = await nonceResponse.text();
        throw new Error(`Không thể lấy nonce: ${errorText}`);
      }

      const data = await nonceResponse.json();
      console.log("Phản hồi nonce:", nonceResponse.status, data);
      const result = NonceSchema.parse(data);
      console.log("Parsed nonce:", result.nonce);

      // Tạo message
      const domain = window.location.host;
      const origin = window.location.origin;
      const statement = "Please sign this message to confirm your identity.";

      const siweMessage = new SiweMessage({
        domain,
        address,
        statement,
        uri: origin,
        version: "1",
        chainId: chainId,
        nonce: result.nonce,
        issuedAt: new Date().toISOString(),
      });

      // Tạo message để ký
      const message = siweMessage.prepareMessage();

      console.log("SIWE message:", message);

      // Thông báo cho người dùng mở ví để ký
      toast.info("Vui lòng mở ví và ký thông điệp để xác nhận...", {
        duration: 5000,
      });

      const signature = await signMessageAsync({ message }).catch((err) => {
        throw new Error(`Ký thông điệp thất bại: ${err.message}`);
      });

      console.log("Signature:", signature);

      // Thông báo đang xác minh chữ ký
      toast.info("Đang xác minh chữ ký...");

      const connectResponse = await fetch("https://api.unitoken.trade/auth/wallet/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": window.location.origin
        },
        body: JSON.stringify({
          message,
          signature: signature.startsWith("0x") ? signature : `0x${signature}`
        }),
        credentials: "include",
      });

      if (!connectResponse.ok) {
        const errorData = await connectResponse.json();
        console.log("Connect response error:", errorData);
        throw new Error(`Không thể kết nối ví: ${errorData}`);
      }

      toast.success("Kết nối ví thành công!");
      router.push("/");

    } catch (error) {
      console.error("Lỗi sau kết nối:", error);

      if (error instanceof Error) {
        if (error.message.includes("Ký thông điệp thất bại")) {
          toast.error("Ký thông điệp thất bại. Vui lòng thử lại.");
        } else if (error.message.includes("Người dùng từ chối")) {
          toast.error("Bạn đã từ chối ký thông điệp. Vui lòng đồng ý để tiếp tục.");
        } else {
          toast.error(`Lỗi: ${error.message}`);
        }
      } else {
        toast.error("Đã xảy ra lỗi không xác định. Vui lòng thử lại.");
      }
    } finally {
      setIsSigning(false);
    }
  };

  const handleWalletConnectLogin = async () => {
    if (isConnected && address) {
      toast.info("Ví đã được kết nối. Đang chuẩn bị xác thực...");
      await handlePostConnection();
      return;
    }

    try {
      const injectedConnector = connectors.find((c) => c.id === "injected");
      const walletConnectConnector = connectors.find((c) => c.id === "walletConnect");

      if (injectedConnector && window.ethereum) {
        console.log("Kết nối bằng injected connector...");
        toast.info("Vui lòng mở ví và chấp nhận kết nối...");
        await connect({ connector: injectedConnector });
      } else if (walletConnectConnector) {
        console.log("Kết nối bằng WalletConnect...");
        toast.info("Đang mở WalletConnect...");
        await connect({ connector: walletConnectConnector });
      } else {
        toast.error("Không tìm thấy ví phù hợp. Vui lòng cài đặt MetaMask hoặc WalletConnect.");
        console.error("Không tìm thấy connector injected hoặc walletConnect.");
      }
    } catch (error) {
      console.error("Lỗi kết nối ví:", error);

      if (error instanceof Error) {
        if (error.message.includes("User rejected")) {
          toast.error("Bạn đã từ chối kết nối ví. Vui lòng thử lại.");
        } else {
          toast.error(`Kết nối thất bại: ${error.message}`);
        }
      } else {
        toast.error("Kết nối ví thất bại. Vui lòng thử lại.");
      }
    }
  };

  const getButtonText = () => {
    if (isConnecting) return "Đang kết nối ví...";
    if (isSigning) return "Đang chờ ký số...";
    if (isConnected) return "Tiếp tục với WalletConnect";
    return "Tiếp tục với WalletConnect";
  };

  return (
    <Button
      variant="secondary"
      className={cn(className)}
      onClick={handleWalletConnectLogin}
      disabled={isConnecting || isSigning}
      {...props}
    >
      <img src="/walletconnect.svg" className="h-4 w-4 mr-2" alt="WalletConnect" />
      {getButtonText()}
    </Button>
  );
}