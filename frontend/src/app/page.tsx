"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Send,
  Sparkles,
  Shield,
  FileText,
  Loader2,
  RefreshCw,
  AlertTriangle,
  FileUp,
  ArrowRight,
  BookOpen,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { CitationBadge } from "@/components/CitationBadge";
import { CitationDrawer } from "@/components/CitationDrawer";
import { useAuth } from "@/lib/auth";
import { streamChatResponse, Citation, ChatMessage, fetchDocuments } from "@/lib/api";

const SUGGESTED_QUERIES_WITH_DOCS = [
  "What is the capital gains tax offset for municipal bonds under 2024 rules?",
  "Management fee caps and liquidity terms for Level-A discretionary portfolios",
  "Can non-resident individuals (NRIs) invest in High-Yield Debt Funds?",
  "What is the early redemption penalty for Tier-1 bonds?",
];

const SUGGESTED_QUERIES_ZERO_DOCS = [
  "How can you help me?",
  "Who are you and what can you do?",
  "How do I upload and manage policy documents?",
  "What document formats and policy types are supported?",
];

export default function ChatPage() {
  const router = useRouter();
  const { user, token, isLoading } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMounted, setHasMounted] = useState(false);
  const [docCount, setDocCount] = useState<number | null>(null);
  const [inputQuery, setInputQuery] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoading && !token) {
      router.push("/login");
    }
  }, [isLoading, token, router]);

  // Query tenant document count on load to detect zero-document state
  useEffect(() => {
    if (!token) return;
    fetchDocuments(token)
      .then((res) => {
        setDocCount(res.total ?? 0);
      })
      .catch((err) => {
        console.warn("Failed to fetch documents count:", err);
      });
  }, [token]);

  // Load chat history safely on mount
  useEffect(() => {
    if (!user) return;
    try {
      const key = `gaa_chat_history_${user.id}`;
      const saved = localStorage.getItem(key) || localStorage.getItem("gaa_chat_history");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch (e) {
      console.error("Failed to parse saved chat history:", e);
    }
    setHasMounted(true);
  }, [user]);

  // Persist chat history only AFTER initial mount has finished
  useEffect(() => {
    if (!hasMounted || !user) return;
    try {
      const key = `gaa_chat_history_${user.id}`;
      const toSave = messages.filter((m) => m.content && m.content.trim().length > 0);
      localStorage.setItem(key, JSON.stringify(toSave));
      localStorage.setItem("gaa_chat_history", JSON.stringify(toSave));
    } catch (e) {
      console.error("Failed to save chat history:", e);
    }
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isGenerating, hasMounted, user]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy-950 font-sans">
        <Loader2 className="h-8 w-8 text-gold-400 animate-spin" />
      </div>
    );
  }

  const handleSend = async (queryText?: string) => {
    const query = queryText || inputQuery;
    if (!query.trim() || isGenerating || !token) return;

    const userMessage: ChatMessage = { role: "user", content: query };
    const initialAssistantMessage: ChatMessage = { role: "assistant", content: "", citations: [] };

    setMessages((prev) => [...prev, userMessage, initialAssistantMessage]);
    setInputQuery("");
    setIsGenerating(true);

    const historyPayload = messages
      .filter((m) => m.content && m.content.trim().length > 0)
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content }));

    let streamedContent = "";

    await streamChatResponse(
      token,
      query,
      historyPayload,
      (tokenChunk) => {
        streamedContent += tokenChunk;
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
            const isOutOfContext =
              streamedContent.includes("[ALERT: OUTSIDE_PDF_SCOPE]") ||
              streamedContent.includes("[OUTSIDE_CONTEXT]") ||
              streamedContent.includes("[NO_DOCS_UPLOADED]") ||
              streamedContent.includes("I cannot find approved bank guidance on this topic") ||
              streamedContent.includes("Compliance and Legal Department");
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: streamedContent,
              isRefusal: isOutOfContext,
            };
          }
          return updated;
        });
      },
      (citations) => {
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
            updated[lastIdx] = {
              ...updated[lastIdx],
              citations,
            };
          }
          return updated;
        });
      },
      () => {
        setIsGenerating(false);
      },
      (err) => {
        setIsGenerating(false);
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: `Error: ${err.message || "Failed to generate answer"}`,
            };
          }
          return updated;
        });
      }
    );
  };

  const renderInlineFormatted = (text: string, citations?: Citation[]) => {
    const parts = text.split(/(\[Doc:[^\]]+\])/g);

    return parts.map((part, index) => {
      if (part.startsWith("[Doc:") && part.endsWith("]")) {
        const cleanPart = part.slice(1, -1);
        return (
          <CitationBadge
            key={`cit-${index}`}
            citationText={cleanPart}
            onClick={() => {
              const match = citations?.find(
                (c) =>
                  cleanPart.includes(c.document_name) ||
                  cleanPart.includes(c.clause_id)
              ) || {
                document_name: cleanPart.split(",")[0]?.replace("Doc:", "").trim() || "Policy Doc",
                version: "v1.0",
                clause_id: cleanPart.split("Clause:")[1]?.trim() || "Approved Rule",
                page_number: 1,
                excerpt: "Verified policy chunk from account knowledge store.",
                score: 0.92,
              };
              setSelectedCitation(match);
              setIsDrawerOpen(true);
            }}
          />
        );
      }

      // Handle bold formatting inside text segments
      const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
      return boldParts.map((bPart, bIdx) => {
        if (bPart.startsWith("**") && bPart.endsWith("**")) {
          return (
            <strong key={`b-${index}-${bIdx}`} className="text-white font-semibold">
              {bPart.slice(2, -2)}
            </strong>
          );
        }
        // Handle code spans `code`
        const codeParts = bPart.split(/(`[^`]+`)/g);
        return codeParts.map((cPart, cIdx) => {
          if (cPart.startsWith("`") && cPart.endsWith("`")) {
            return (
              <code key={`c-${index}-${bIdx}-${cIdx}`} className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white/10 text-gold-300 border border-white/10 mx-0.5">
                {cPart.slice(1, -1)}
              </code>
            );
          }
          return <span key={`t-${index}-${bIdx}-${cIdx}`}>{cPart}</span>;
        });
      });
    });
  };

  const renderFormattedMessage = (rawContent: string, citations?: Citation[], isRefusal?: boolean) => {
    let content = rawContent;

    if (content.startsWith("Error:")) {
      return (
        <div className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-3.5 text-rose-200">
          <div className="flex items-center gap-2 font-bold text-rose-400 text-xs sm:text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Advisory Service Notice</span>
          </div>
          <p className="mt-1 text-xs text-rose-200/90 leading-relaxed font-sans">
            {content.replace(/^Error:\s*/, "")}
          </p>
        </div>
      );
    }

    if (!content.trim()) {
      return (
        <div className="flex items-center gap-2 text-slate-400 py-1 text-xs">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-gold-400 shrink-0" />
          <span className="font-sans">Generating response...</span>
        </div>
      );
    }

    let isNoDocs = false;
    let isOutOfContext = isRefusal || false;

    if (content.includes("[NO_DOCS_UPLOADED]")) {
      isNoDocs = true;
      isOutOfContext = true;
      content = content.replace(/\[NO_DOCS_UPLOADED\]\s*/g, "");
    }

    if (content.includes("[ALERT: OUTSIDE_PDF_SCOPE]")) {
      isOutOfContext = true;
      content = content.replace(/\[ALERT: OUTSIDE_PDF_SCOPE\]\s*/g, "");
    }

    if (content.includes("[OUTSIDE_CONTEXT]")) {
      isOutOfContext = true;
      content = content.replace(/\[OUTSIDE_CONTEXT\]\s*/g, "");
    }

    const refusalMarker =
      "I cannot find approved bank guidance on this topic within your account's uploaded documentation. Please escalate this request to the Compliance and Legal Department.";
    if (content.includes(refusalMarker)) {
      isOutOfContext = true;
      content = content.replace(refusalMarker, "").trim();
    }

    const lines = content.split("\n");
    const elements: React.ReactNode[] = [];
    let currentList: React.ReactNode[] = [];

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) {
        if (currentList.length > 0) {
          elements.push(
            <ul key={`ul-${idx}`} className="space-y-1.5 my-2 pl-1">
              {currentList}
            </ul>
          );
          currentList = [];
        }
        return;
      }

      // Markdown Headings & Structure
      if (trimmed.startsWith("#### ")) {
        if (currentList.length > 0) {
          elements.push(
            <ul key={`ul-${idx}`} className="space-y-1.5 my-2 pl-1">
              {currentList}
            </ul>
          );
          currentList = [];
        }
        elements.push(
          <h4
            key={`h4-${idx}`}
            className="font-heading font-bold text-gold-200 text-xs sm:text-[13px] mt-3.5 mb-1 flex items-center gap-1.5 tracking-wide"
          >
            <Sparkles className="h-3 w-3 text-gold-400 shrink-0" />
            <span>{trimmed.replace(/^####\s+/, "")}</span>
          </h4>
        );
      } else if (trimmed.startsWith("### ")) {
        if (currentList.length > 0) {
          elements.push(
            <ul key={`ul-${idx}`} className="space-y-1.5 my-2 pl-1">
              {currentList}
            </ul>
          );
          currentList = [];
        }
        elements.push(
          <h3
            key={`h3-${idx}`}
            className="font-heading font-bold text-gold-300 text-xs sm:text-sm mt-4 mb-1.5 flex items-center gap-1.5 tracking-wide"
          >
            <Sparkles className="h-3.5 w-3.5 text-gold-400 shrink-0" />
            <span>{trimmed.replace(/^###\s+/, "")}</span>
          </h3>
        );
      } else if (trimmed.startsWith("## ")) {
        if (currentList.length > 0) {
          elements.push(
            <ul key={`ul-${idx}`} className="space-y-1.5 my-2 pl-1">
              {currentList}
            </ul>
          );
          currentList = [];
        }
        elements.push(
          <h2
            key={`h2-${idx}`}
            className="font-heading font-bold text-white text-sm sm:text-base mt-4 mb-2 text-gold-400 tracking-tight"
          >
            {trimmed.replace(/^##\s+/, "")}
          </h2>
        );
      } else if (trimmed.startsWith("# ")) {
        if (currentList.length > 0) {
          elements.push(
            <ul key={`ul-${idx}`} className="space-y-1.5 my-2 pl-1">
              {currentList}
            </ul>
          );
          currentList = [];
        }
        elements.push(
          <h1
            key={`h1-${idx}`}
            className="font-heading font-bold text-white text-base sm:text-lg mt-4 mb-2 tracking-tight"
          >
            {trimmed.replace(/^#\s+/, "")}
          </h1>
        );
      } else if (trimmed === "---" || trimmed === "***") {
        if (currentList.length > 0) {
          elements.push(
            <ul key={`ul-${idx}`} className="space-y-1.5 my-2 pl-1">
              {currentList}
            </ul>
          );
          currentList = [];
        }
        elements.push(
          <div key={`hr-${idx}`} className="h-px w-full bg-gradient-to-r from-transparent via-white/15 to-transparent my-3.5" />
        );
      } else if (trimmed.startsWith("> ")) {
        if (currentList.length > 0) {
          elements.push(
            <ul key={`ul-${idx}`} className="space-y-1.5 my-2 pl-1">
              {currentList}
            </ul>
          );
          currentList = [];
        }
        elements.push(
          <div
            key={`quote-${idx}`}
            className="border-l-2 border-gold-400/80 bg-gold-500/10 px-3.5 py-2 my-2 rounded-r-xl text-slate-200 text-xs sm:text-[12.5px] font-sans leading-relaxed shadow-sm"
          >
            {renderInlineFormatted(trimmed.replace(/^>\s*/, ""), citations)}
          </div>
        );
      } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ")) {
        const itemText = trimmed.replace(/^[-*•]\s+/, "");
        currentList.push(
          <li
            key={`li-${idx}`}
            className="flex items-start gap-2 text-slate-200 text-xs sm:text-[13px] leading-relaxed"
          >
            <span className="text-gold-400 font-bold shrink-0 mt-0.5">•</span>
            <div className="flex-1">{renderInlineFormatted(itemText, citations)}</div>
          </li>
        );
      } else if (/^\d+\.\s+/.test(trimmed)) {
        if (currentList.length > 0) {
          elements.push(
            <ul key={`ul-${idx}`} className="space-y-1.5 my-2 pl-1">
              {currentList}
            </ul>
          );
          currentList = [];
        }
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
        const num = numMatch ? numMatch[1] : "1";
        const itemText = numMatch ? numMatch[2] : trimmed;
        elements.push(
          <div
            key={`num-${idx}`}
            className="flex items-start gap-2.5 my-2 text-slate-200 text-xs sm:text-[13px] leading-relaxed"
          >
            <span className="font-condensed font-bold text-[11px] px-1.5 py-0.5 rounded bg-gold-500/15 text-gold-400 border border-gold-500/30 shrink-0 mt-0.5">
              {num}
            </span>
            <div className="flex-1">{renderInlineFormatted(itemText, citations)}</div>
          </div>
        );
      } else {
        if (currentList.length > 0) {
          elements.push(
            <ul key={`ul-${idx}`} className="space-y-1.5 my-2 pl-1">
              {currentList}
            </ul>
          );
          currentList = [];
        }
        elements.push(
          <p
            key={`p-${idx}`}
            className="text-slate-200 text-xs sm:text-[13px] leading-relaxed my-1 font-sans"
          >
            {renderInlineFormatted(trimmed, citations)}
          </p>
        );
      }
    });

    if (currentList.length > 0) {
      elements.push(
        <ul key="ul-last" className="space-y-1.5 my-2 pl-1">
          {currentList}
        </ul>
      );
    }

    return (
      <div className="space-y-2">
        {/* Prominent Alert Notice for Questions Outside Uploaded PDFs */}
        {isOutOfContext && (
          <div className="mb-3.5 overflow-hidden rounded-xl border-l-4 border-amber-500 bg-amber-950/40 p-3 sm:p-4 text-amber-200 border-y border-r border-amber-500/25 shadow-lg shadow-amber-950/40 backdrop-blur-md">
            <div className="flex items-center justify-between gap-2 pb-1.5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <span className="font-heading text-xs sm:text-sm font-bold uppercase tracking-wider text-amber-300">
                  {isNoDocs ? "No Policy PDFs In System" : "Notice: Question Outside Uploaded PDF Scope"}
                </span>
              </div>
              <span className="font-condensed text-[10px] sm:text-[11px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {isNoDocs ? "Upload Required" : "Advisory Alert"}
              </span>
            </div>

            {/* Glowing Amber Line Accent */}
            <div className="h-0.5 w-full bg-gradient-to-r from-amber-500 via-amber-400/80 to-transparent my-1.5" />

            <p className="mt-1 text-xs sm:text-[12.5px] font-sans text-amber-200/90 leading-relaxed">
              {isNoDocs ? (
                <>
                  Your workspace currently has <strong className="text-white font-semibold">no policy PDF documents uploaded</strong>.
                  Upload your institution&apos;s approved PDFs to enable verified clause citations and grounded answers.
                </>
              ) : (
                <>
                  This question is <strong className="text-white font-semibold">not found in or covered by your uploaded PDF documents</strong>. 
                  The response below is provided for general advisory context. For verified bank policy decisions, refer to your approved PDFs.
                </>
              )}
            </p>

            {isNoDocs && (
              <div className="mt-3 pt-2.5 border-t border-amber-500/20 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-amber-300/80 font-sans">
                  Ready to add your policy guidelines?
                </span>
                <Link
                  href="/documents"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-navy-950 font-bold font-condensed text-xs uppercase tracking-wider transition-all shadow-md shadow-amber-950/40"
                >
                  <FileUp className="h-3.5 w-3.5" />
                  <span>Go to Document Store &amp; Upload PDF</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}
          </div>
        )}

        <div className="space-y-1">
          {elements.length > 0 ? (
            elements
          ) : (
            <p className="text-slate-200 text-xs sm:text-[13px] leading-relaxed font-sans">
              {content}
            </p>
          )}
        </div>

        {citations && citations.length > 0 && (
          <div className="pt-2.5 mt-2 border-t border-white/10 flex flex-wrap gap-1.5 items-center">
            <span className="font-condensed text-[10px] uppercase tracking-wider text-slate-400 font-semibold mr-1 flex items-center gap-1">
              <FileText className="h-3 w-3 text-gold-400" /> Cited Sources:
            </span>
            {citations.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setSelectedCitation(c);
                  setIsDrawerOpen(true);
                }}
                className="font-condensed rounded-full bg-white/5 hover:bg-gold-500/20 px-2.5 py-0.5 text-[11px] font-medium text-slate-300 hover:text-gold-300 border border-white/10 transition-colors tracking-wide cursor-pointer"
              >
                {c.document_name} ({c.clause_id})
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const isZeroDocs = docCount === 0;
  const suggestedQueries = isZeroDocs ? SUGGESTED_QUERIES_ZERO_DOCS : SUGGESTED_QUERIES_WITH_DOCS;

  return (
    <div className="min-h-screen flex flex-col bg-navy-950 font-sans selection:bg-gold-500 selection:text-navy-950">
      <Navbar />

      <main className="flex-1 max-w-5xl w-full mx-auto p-3 sm:p-5 md:p-6 flex flex-col justify-between min-h-0">
        {/* Chat History */}
        <div className="flex-1 overflow-y-auto space-y-4 pb-4 sm:pb-6 px-1 sm:px-2 scroll-smooth">
          {messages.length === 0 ? (
            <div className="py-8 sm:py-10 text-center space-y-5 max-w-2xl mx-auto">
              <div className="inline-flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-gold-400 to-gold-600 shadow-2xl shadow-gold-500/20">
                <Shield className="h-8 w-8 sm:h-9 sm:w-9 text-navy-950" />
              </div>

              <div className="space-y-2">
                <h1 className="font-heading text-lg sm:text-2xl font-bold text-white tracking-tight">
                  Welcome to WealthGuard Advisory Terminal
                </h1>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed font-sans max-w-xl mx-auto">
                  Ask complex wealth management policy, product, and tax queries. When you ask questions covered by your PDFs, responses are strictly grounded with clause citations. General and external questions are highlighted with an advisory notice.
                </p>
              </div>

              {/* Zero-PDF Warning Card */}
              {isZeroDocs && (
                <div className="text-left rounded-2xl border border-gold-500/30 bg-gold-500/10 p-4 sm:p-5 shadow-lg backdrop-blur-md space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-5 w-5 text-gold-400 shrink-0" />
                      <h3 className="font-heading font-bold text-white text-sm sm:text-base">
                        No Policy PDFs Uploaded Yet
                      </h3>
                    </div>
                    <span className="font-condensed text-[11px] font-semibold tracking-wider uppercase px-2.5 py-0.5 rounded-full bg-gold-500/20 text-gold-300 border border-gold-500/30">
                      Setup Guide
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed font-sans">
                    WealthGuard AI provides strictly grounded answers citing specific clauses from your uploaded documents. 
                    Upload your institution&apos;s approved PDFs (e.g., investment mandates, fund factsheets, or tax circulars) to activate grounded Q&amp;A.
                  </p>
                  <div className="pt-1 flex flex-wrap items-center gap-3">
                    <Link
                      href="/documents"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-gold-500 to-gold-600 hover:from-gold-400 hover:to-gold-500 text-navy-950 font-bold font-condensed text-xs uppercase tracking-wider transition-all shadow-md shadow-gold-500/20 active:scale-95"
                    >
                      <FileUp className="h-4 w-4" />
                      <span>Upload Your First PDF Document</span>
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              )}

              {/* Sample Queries */}
              <div className="space-y-2 pt-1">
                <span className="font-condensed text-[11px] uppercase tracking-wider text-slate-400 font-semibold block text-left px-1">
                  {isZeroDocs ? "Try Starting With:" : "Suggested Advisory Inquiries:"}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                  {suggestedQueries.map((sq, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSend(sq)}
                      className="glass-card hover:bg-white/10 rounded-xl p-3 text-xs text-slate-300 hover:text-gold-300 border border-white/5 transition-all text-left flex items-start gap-2.5 group cursor-pointer"
                    >
                      <Sparkles className="h-4 w-4 text-gold-400 shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                      <span className="leading-snug font-sans">{sq}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex justify-end pb-1 sm:pb-2">
                <button
                  type="button"
                  onClick={() => {
                    setMessages([]);
                    if (typeof window !== "undefined") {
                      if (user) {
                        localStorage.removeItem(`gaa_chat_history_${user.id}`);
                      }
                      localStorage.removeItem("gaa_chat_history");
                    }
                  }}
                  className="font-condensed flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-white/5 transition-all cursor-pointer uppercase tracking-wider"
                >
                  <RefreshCw className="h-3 w-3" />
                  Clear History
                </button>
              </div>
              {messages.map((msg, index) => {
                const isUser = msg.role === "user";
                const isRefusal = msg.isRefusal;

                return (
                  <div
                    key={index}
                    className={`flex items-start gap-2 sm:gap-3 ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    {!isUser && (
                      <div className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-xl bg-gold-500/15 border border-gold-500/30 text-gold-400 shadow-sm mt-0.5">
                        <Shield className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      </div>
                    )}

                    <div
                      className={`rounded-2xl px-3.5 py-3 sm:px-4 sm:py-3.5 text-xs sm:text-[13px] max-w-[90%] sm:max-w-2xl shadow-sm ${
                        isUser
                          ? "bg-gradient-to-r from-gold-500 to-gold-600 text-navy-950 font-medium font-sans ml-auto"
                          : "glass-panel border-white/10 text-slate-200"
                      }`}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap font-sans leading-relaxed">{msg.content}</p>
                      ) : !msg.content && isGenerating ? (
                        <div className="flex items-center gap-2.5 text-slate-300 py-1">
                          <Loader2 className="h-4 w-4 animate-spin text-gold-400 shrink-0" />
                          <span className="font-sans text-xs sm:text-[13px]">Searching knowledge store and generating response...</span>
                        </div>
                      ) : (
                        renderFormattedMessage(msg.content, msg.citations, isRefusal)
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input Bar */}
        <div className="sticky bottom-0 pt-2 pb-2 sm:pb-3 bg-navy-950/95 backdrop-blur-md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="glass-panel rounded-2xl p-1.5 sm:p-2 flex items-center gap-2 border border-white/15 focus-within:border-gold-500/50 shadow-xl"
          >
            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              placeholder="Ask a question about your uploaded PDFs, or general advisory questions..."
              disabled={isGenerating}
              className="flex-1 bg-transparent px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none font-sans"
            />
            <button
              type="submit"
              disabled={isGenerating || !inputQuery.trim()}
              className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-gold-500 to-gold-600 hover:from-gold-400 hover:to-gold-500 text-navy-950 font-bold disabled:opacity-40 transition-all cursor-pointer shadow-md shadow-gold-500/10 active:scale-95"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </form>
          <div className="mt-1.5 sm:mt-2 text-center font-condensed text-[10px] sm:text-[11px] text-slate-500 uppercase tracking-wider">
            Grounded in current-version documentation. Questions outside uploaded PDFs are highlighted with an advisory notice.
          </div>
        </div>
      </main>

      {/* Slide-Out Citation Inspection Drawer */}
      <CitationDrawer
        isOpen={isDrawerOpen}
        citation={selectedCitation}
        onClose={() => setIsDrawerOpen(false)}
      />
    </div>
  );
}
