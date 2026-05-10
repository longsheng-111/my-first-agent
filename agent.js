const axios = require('axios');

// 1. 配置大模型（改为环境变量）
const LLM_CONFIG = {
  apiKey: process.env.LLM_API_KEY,
  endpoint: process.env.LLM_ENDPOINT || 'https://linkapi.ai/v1/chat/completions',
  model: process.env.LLM_MODEL || 'deepseek-chat'
};

if (!LLM_CONFIG.apiKey) {
  throw new Error('缺少环境变量 LLM_API_KEY，请先设置后再运行。');
}

// 简单命令白名单（可按需扩展）
const SAFE_COMMAND_PREFIX = ['dir', 'type', 'echo', 'node -v', 'npm -v'];
function isSafeCommand(cmd) {
  const normalized = cmd.trim().toLowerCase();
  return SAFE_COMMAND_PREFIX.some((prefix) => normalized.startsWith(prefix));
}

// 2. 定义Agent可用工具（核心：你可以无限扩展业务工具）
const tools = {
  // 工具1：执行shell命令（开发常用）
  runShell: async ({ cmd }) => {
    const { execSync } = require('child_process');
    if (!cmd || typeof cmd !== 'string') {
      return 'runShell 参数错误：需要 {"cmd":"..."}';
    }
    if (!isSafeCommand(cmd)) {
      return `命令被拒绝（不在白名单）：${cmd}`;
    }
    try {
      return execSync(cmd, { encoding: 'utf8' });
    } catch (e) {
      return `命令执行失败: ${e.message}`;
    }
  },

  // 工具2：读取本地文件
  readFile: async ({ path }) => {
    const fs = require('fs');
    if (!path || typeof path !== 'string') {
      return 'readFile 参数错误：需要 {"path":"..."}';
    }
    try {
      return fs.readFileSync(path, 'utf8');
    } catch (e) {
      return `读取文件失败: ${e.message}`;
    }
  },

  // 工具3：业务工具示例：生成CRUD接口代码
  genCrud: async ({ tableName }) => {
    if (!tableName || typeof tableName !== 'string') {
      return 'genCrud 参数错误：需要 {"tableName":"..."}';
    }
    return `
// 自动生成的 ${tableName} CRUD 接口
- 查询列表
- 新增
- 修改
- 删除
    `;
  }
};

// 3. 调用大模型
async function llmChat(messages) {
  try {
    const res = await axios.post(
      LLM_CONFIG.endpoint,
      {
        model: LLM_CONFIG.model,
        messages,
        temperature: 0.3
      },
      {
        headers: {
          Authorization: `Bearer ${LLM_CONFIG.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      }
    );

    const content = res?.data?.choices?.[0]?.message?.content;
    if (!content) {
      return `模型返回格式异常：${JSON.stringify(res.data)}`;
    }
    return content;
  } catch (e) {
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    return `LLM调用失败: ${detail}`;
  }
}

// 解析 Agent 返回：优先 JSON，失败则视作 final
function parseAgentReply(reply) {
  try {
    return JSON.parse(reply);
  } catch {
    return { action: 'final', answer: reply };
  }
}

// 4. 核心：Agent 循环执行引擎
async function runAgent(userGoal) {
  const maxSteps = 10;

  // 上下文记忆
  let messages = [
    {
      role: "system",
      content: `
你是一个业务AI Agent，你可以使用这些工具：
1. runShell({"cmd":"命令"})
2. readFile({"path":"文件路径"})
3. genCrud({"tableName":"表名"})

请严格返回 JSON，不要返回其他文字：
{
  "action": "tool" | "final",
  "tool": "runShell" | "readFile" | "genCrud",
  "args": {},
  "answer": "当 action=final 时填写"
}
      `
    },
    { role: "user", content: userGoal }
  ];

  // Agent 循环：直到完成任务或达到上限
  for (let step = 1; step <= maxSteps; step++) {
    const reply = await llmChat(messages);
    console.log(`\n🤖 Step ${step} 回复：`, reply);

    const action = parseAgentReply(reply);

    // 判断是否要调用工具
    if (action.action === 'tool') {
      const { tool, args } = action;
      if (!tools[tool]) {
        messages.push({ role: "assistant", content: reply });
        messages.push({ role: "user", content: `工具执行失败：工具不存在: ${tool}，请改用可用工具继续任务` });
        continue;
      }

      // 执行工具
      const toolResult = await tools[tool](args || {});
      console.log("🔧 工具执行结果：", toolResult);

      // 把工具结果丢回上下文，让Agent继续规划下一步
      messages.push({ role: "assistant", content: reply });
      messages.push({ role: "user", content: `工具返回结果：${toolResult}，请继续完成任务` });
    } else {
      // 不需要工具，任务结束
      console.log("\n✅ 任务完成：", action.answer || reply);
      return;
    }
  }

  console.log("\n⛔ 超过最大执行步数，任务终止。");
}

// 5. 启动Agent，给一个业务目标
// runAgent("帮我生成用户表的CRUD代码");
runAgent("读取 agent.js 前20行并总结这个文件做了什么");
