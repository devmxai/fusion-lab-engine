import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { LocalCommerceError, LocalCommerceService } from "./service.ts";

function header(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof LocalCommerceError) {
    return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } });
  }
  throw error;
}

function parseJsonBuffer(body: unknown): unknown {
  if (!Buffer.isBuffer(body)) throw new LocalCommerceError("RAW_COMMERCE_BODY_REQUIRED", 400, "Commerce endpoint requires an exact raw JSON body.");
  try { return JSON.parse(body.toString("utf8")); } catch { throw new LocalCommerceError("INVALID_COMMERCE_JSON", 400, "Commerce request body must be valid JSON."); }
}

export async function registerCommerceRoutes(app: FastifyInstance, options: { service: LocalCommerceService }) {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => done(null, body));

  app.get("/v1/dev/commerce/catalog", async () => options.service.catalog());
  app.get("/v1/dev/commerce/plans", async () => ({ plans: options.service.plans() }));
  app.get("/v1/dev/commerce/promotions", async () => options.service.promotionCatalog());
  app.get("/v1/dev/commerce/reconciliation", async () => options.service.reconciliation());
  app.get<{ Params: { campaignVersionId: string } }>("/v1/dev/commerce/promotions/budgets/:campaignVersionId", async (request, reply) => {
    try { return reply.code(200).send(options.service.promotionBudget(request.params.campaignVersionId)); } catch (error) { return handleError(error, request, reply); }
  });
  app.get<{ Params: { reservationId: string } }>("/v1/dev/commerce/promotions/reservations/:reservationId", async (request, reply) => {
    try { return reply.code(200).send(options.service.promotionReservation(request.params.reservationId)); } catch (error) { return handleError(error, request, reply); }
  });
  app.get<{ Querystring: { campaignVersionId?: string } }>("/v1/dev/commerce/promotions/subsidy-entries", async (request) => ({
    entries: options.service.promotionSubsidyEntries(request.query.campaignVersionId),
  }));
  app.post("/v1/dev/commerce/checkouts", async (request, reply) => {
    try { return reply.code(201).send(await options.service.createCheckout(parseJsonBuffer(request.body))); } catch (error) { return handleError(error, request, reply); }
  });
  app.get<{ Params: { checkoutId: string } }>("/v1/dev/commerce/checkouts/:checkoutId/success", async (request, reply) => {
    try { return reply.code(200).send(options.service.success(request.params.checkoutId)); } catch (error) { return handleError(error, request, reply); }
  });
  app.post("/v1/dev/commerce/webhooks/provider-for-test", async (request, reply) => {
    try {
      if (!Buffer.isBuffer(request.body)) throw new LocalCommerceError("RAW_PAYMENT_BODY_REQUIRED", 400, "Payment webhook requires exact raw bytes.");
      const result = options.service.processWebhook({
        rawBody: request.body,
        deliveryId: header(request.headers["x-payment-delivery-id"]),
        timestamp: header(request.headers["x-payment-timestamp"]),
        signature: header(request.headers["x-payment-signature"]),
      });
      return reply.code(result.replay || result.duplicateEvent ? 200 : 202).send(result);
    } catch (error) { return handleError(error, request, reply); }
  });
  app.get<{ Params: { eventId: string } }>("/v1/dev/commerce/payment-events/:eventId", async (request, reply) => {
    try { return reply.code(200).send(options.service.paymentEvent(request.params.eventId)); } catch (error) { return handleError(error, request, reply); }
  });
  app.get<{ Params: { invoiceId: string } }>("/v1/dev/commerce/invoices/:invoiceId", async (request, reply) => {
    try { return reply.code(200).send(options.service.invoice(request.params.invoiceId)); } catch (error) { return handleError(error, request, reply); }
  });
  app.get<{ Params: { userId: string } }>("/v1/dev/commerce/invoices/users/:userId", async (request) => ({ invoices: options.service.userInvoices(request.params.userId) }));
  app.get<{ Params: { reversalId: string } }>("/v1/dev/commerce/reversals/:reversalId", async (request, reply) => {
    try { return reply.code(200).send(options.service.financialReversal(request.params.reversalId)); } catch (error) { return handleError(error, request, reply); }
  });
  app.get<{ Params: { userId: string } }>("/v1/dev/commerce/subscriptions/users/:userId", async (request) => ({ subscriptions: options.service.userSubscriptions(request.params.userId) }));
  app.get<{ Params: { subscriptionId: string } }>("/v1/dev/commerce/subscriptions/:subscriptionId", async (request, reply) => {
    try { return reply.code(200).send(options.service.subscription(request.params.subscriptionId)); } catch (error) { return handleError(error, request, reply); }
  });
  app.post<{ Params: { subscriptionId: string } }>("/v1/dev/commerce/subscriptions/:subscriptionId/expire", async (request, reply) => {
    try { return reply.code(200).send(options.service.expireSubscription(request.params.subscriptionId)); } catch (error) { return handleError(error, request, reply); }
  });
}
