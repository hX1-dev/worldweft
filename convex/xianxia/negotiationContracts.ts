import { type Infer, v } from 'convex/values';

export const negotiationKindValidator = v.union(
  v.literal('herb_trade'),
  v.literal('request_deadline'),
  v.literal('event_compensation'),
);
export type NegotiationKind = Infer<typeof negotiationKindValidator>;

export const negotiationStatusValidator = v.union(
  v.literal('opened'),
  v.literal('active'),
  v.literal('settled'),
  v.literal('rejected'),
  v.literal('withdrawn'),
  v.literal('expired'),
);
export type NegotiationStatus = Infer<typeof negotiationStatusValidator>;

export const negotiationProposalStatusValidator = v.union(
  v.literal('active'),
  v.literal('superseded'),
  v.literal('accepted'),
  v.literal('rejected'),
  v.literal('withdrawn'),
  v.literal('expired'),
);
export type NegotiationProposalStatus = Infer<typeof negotiationProposalStatusValidator>;

export const negotiationOperationValidator = v.union(
  v.literal('open'),
  v.literal('counter'),
  v.literal('accept'),
  v.literal('reject'),
  v.literal('withdraw'),
);
export type NegotiationOperation = Infer<typeof negotiationOperationValidator>;

export const herbTradeTermsValidator = v.object({
  kind: v.literal('herb_trade'),
  sellerActorId: v.string(),
  buyerActorId: v.string(),
  itemId: v.literal('spirit_herb'),
  itemQty: v.number(),
  paymentItemId: v.literal('spirit_stone'),
  paymentQty: v.number(),
});
export type HerbTradeTerms = Infer<typeof herbTradeTermsValidator>;

export const requestDeadlineTermsValidator = v.object({
  kind: v.literal('request_deadline'),
  requestId: v.string(),
  issuerActorId: v.string(),
  assigneeActorId: v.string(),
  baseExpiresAtGameHour: v.number(),
  extensionGameHours: v.number(),
});
export type RequestDeadlineTerms = Infer<typeof requestDeadlineTermsValidator>;

export const eventCompensationTermsValidator = v.object({
  kind: v.literal('event_compensation'),
  harmEventId: v.string(),
  encounterId: v.string(),
  payerActorId: v.string(),
  payeeActorId: v.string(),
  harmDamage: v.number(),
  paymentItemId: v.literal('spirit_stone'),
  paymentQty: v.number(),
});
export type EventCompensationTerms = Infer<typeof eventCompensationTermsValidator>;

export const negotiationTermsValidator = v.union(
  herbTradeTermsValidator,
  requestDeadlineTermsValidator,
  eventCompensationTermsValidator,
);
export type NegotiationTerms = Infer<typeof negotiationTermsValidator>;
