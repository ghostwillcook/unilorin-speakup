import type { AppProps } from "next/app";
import { SessionProvider } from "next-auth/react";
import Head from "next/head";
import "@/styles/globals.css";

export default function App({
  Component,
  pageProps: { session, ...pageProps },
}: AppProps) {
  return (
    <SessionProvider session={session}>
      <Head>
        <title>UNILORIN Student Connect</title>
        <meta
          name="description"
          content="Anonymous complaint and chat platform for the University of Ilorin Student Affairs Unit."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0A0A0A" />
      </Head>
      <Component {...pageProps} />
    </SessionProvider>
  );
}
