import { createRequire } from "node:module";
import { inspect } from "node:util";
import type { Jieba } from "@node-rs/jieba";
import { logger } from "../shared/logger";

// 原生模块保持外置，只在调用方的降级保护内按需加载。
const requireNative = createRequire(__filename);
let instance: Jieba | undefined;

export function getSearchJieba(): Jieba {
  if (instance) return instance;
  // 未成功初始化时，每次调用只尝试一次；失败交给调用方立即降级，不等待重试。
  try {
    const { Jieba: NativeJieba } = requireNative("@node-rs/jieba") as typeof import("@node-rs/jieba");
    instance = new NativeJieba();
    return instance;
  } catch (error) {
    // 原生加载器可能把底层错误数组挂在 cause 上；保留 code/stack，
    // 同时用 inspect 安全处理嵌套或循环引用，避免 JSON 序列化丢失诊断。
    logger.warn(
      "Search",
      "@node-rs/jieba initialization failed; using fallback tokenization (Chinese retrieval quality may be reduced).",
      inspect(error, { depth: null }),
    );
    throw error;
  }
}
