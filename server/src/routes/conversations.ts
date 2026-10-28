import { Router, type RequestHandler } from "express";
import type { ChatService } from "../chat/service.js";
import { requireAuth } from "../middleware/session.js";
import { createConversationSchema, parseBody, parseId, sendMessageSchema } from "./validation.js";

export function conversationsRouter(deps: { chat: ChatService; chatLimiter: RequestHandler }): Router {
  const { chat, chatLimiter } = deps;
  const router = Router();
  router.use(requireAuth);
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.get("/", async (req, res) => {
    res.json({ conversations: await chat.listConversations(req.auth!.userId) });
  });

  router.post("/", async (req, res) => {
    const { title } = parseBody(createConversationSchema, req.body);
    res.status(201).json({ conversation: await chat.createConversation(req.auth!.userId, title) });
  });

  router.get("/:id/messages", async (req, res) => {
    const id = parseId(req.params.id);
    const conversation = await chat.getConversation(req.auth!.userId, id);
    const messages = await chat.listMessages(req.auth!.userId, id);
    res.json({ conversation, messages });
  });

  router.post("/:id/messages", chatLimiter, async (req, res) => {
    const id = parseId(req.params.id);
    const { content, clientMessageId } = parseBody(sendMessageSchema, req.body);
    const result = await chat.sendMessage(req.auth!.userId, id, content, clientMessageId);
    res.status(201).json(result);
  });

  router.post("/:id/messages/:messageId/retry", chatLimiter, async (req, res) => {
    const id = parseId(req.params.id);
    const messageId = parseId(req.params.messageId);
    res.json(await chat.retry(req.auth!.userId, id, messageId));
  });

  router.delete("/:id", async (req, res) => {
    await chat.deleteConversation(req.auth!.userId, parseId(req.params.id));
    res.status(204).end();
  });

  return router;
}
