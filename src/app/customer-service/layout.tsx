import { SWRProvider } from "@/lib/swr-provider";

export default function CustomerServiceLayout({ children }: { children: React.ReactNode }) {
  return <SWRProvider>{children}</SWRProvider>;
}
