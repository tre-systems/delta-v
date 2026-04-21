# Type System & Validation Patterns

How Delta-V keeps bad data out of the engine and bad requests out of the server. The coding standards document covers general TypeScript style; this chapter walks through the project-specific techniques.

Each section covers the pattern, a minimal example, where it lives, and why this shape.

---

## Branded Types for Nominal Typing

Raw string values that mean different things — hex keys, room codes, player tokens — are branded at the type level so they cannot be substituted for each other. The brand is a phantom property, meaning it carries zero runtime cost.

In practice, there are two ways to build a branded value. The structured constructor takes a typed coordinate and produces a hex key from it. The unsafe cast converts any plain string into a branded type, and this is used only at serialization boundaries. TypeScript then prevents mix-ups: passing a plain string where a hex key is expected is a compile-time error, while passing a properly constructed hex key is fine.

The hex key type lives in the hex utility module in the shared folder. Room codes, player tokens, game IDs, agent tokens, and match tokens all live in the shared IDs module. That module also provides runtime guards for checking whether a value is a valid room code or player token, along with normalization functions.

The reasons for this shape are threefold. First, branded types vanish at runtime, so there is zero overhead. Second, using two distinct function names — one for the structured constructor, one for the unsafe cast — tells reviewers at a glance which invariants hold. Third, before branding, a function accepting any string could be called with anything; after branding, only the correct kind of string passes.

---

## Multi-Stage Validation Pipeline

Incoming client messages pass through four distinct validation stages, each with its own error surface. Rate limits come first so flood attacks cannot exhaust the later, more expensive stages; the engine is last and trusts its input by that point.

The flow moves as follows. A WebSocket message arrives and immediately hits the rate-limit check. If the rate is exceeded, the socket is closed. Otherwise the message proceeds to JSON parsing. If parsing fails, a structured error is returned. If parsing succeeds, the now-typed but unvalidated message moves to shape and size validation. If the shape is wrong or the payload is too large, another structured error is returned and an error message is sent to the client. If validation passes, the message moves into the engine as a typed client-to-server value. The engine can reject the action for rule violations — wrong phase, wrong turn, resource limits — returning an engine failure with an error code. On success, the engine produces a new state and a list of events.

Stage zero, the rate-limit check, lives in the socket module's rate-limit function. Stage one, JSON parsing, is in the same socket module. Stage two, shape and size validation, lives in the shared protocol module. Stage three, engine calls, lives in the engine entry points under the shared engine folder. A runner in the server actions module wraps engine calls in a try-catch so that unexpected throws become typed errors rather than state corruption.

Three design reasons explain this shape. First, failing early and cheaply means flood detection and JSON parsing happen at the byte level before spending time on shape checks. Second, each stage owns its error type: stage two returns a result with a clear invalid-shape message, while stage three returns an engine failure with a code. Third, size limits are enforced at stage two — maximum fleet purchases, maximum astrogation orders, maximum ordnance launches, maximum combat attacks — so no engine code has to defensively check array sizes.

---

## Error Code Enum

A closed string enum carries the category of a runtime error across the protocol boundary. The client decides what to do with it; the server simply names the category.

The enum covers timing errors such as invalid phase and not-your-turn, reference errors such as invalid ship and invalid target, input errors, authorization errors, resource limit errors, and consistency errors. A server-to-client error message carries the error code alongside a human-readable message string.

The enum lives in the shared domain types module. It is attached to the server-to-client error message type in the shared protocol types module. The engine returns it inside an engine failure value.

Three reasons justify this shape. First, string values survive serialization cleanly and read well in telemetry dashboards. Second, the client can branch on specific codes: a state-conflict code means the client should re-read state and retry, while an invalid-input code means the interface sent something wrong and should surface a different message. Third, the code field is optional, so errors originating outside the engine — rate limits, server internals — do not need to invent a code.

---

## Rate Limiting

Multiple rate-limit layers operate at different scopes. An edge or Worker layer caps requests per IP address; a Durable Object layer caps per socket and per player. Each layer has a tight, specific reason to exist.

At the socket level, there is a hard cap on messages per second. Exceeding it closes the socket with a standard protocol-violation close code. At the player level, there is a soft throttle on chat messages: a minimum gap must elapse between messages, and messages sent within that window are silently dropped.

Canonical values for all limits are documented in the security documentation. Constants for the Worker-level per-IP limits live in the server reporting module; constants for the Durable Object-level per-socket and per-player limits live in the socket module.

Three design reasons support this layered approach. First, each layer catches a different class of attack: per-IP Worker limits catch mass room-creation or probe scanning, per-socket Durable Object limits catch a single connection flooding, and the per-player chat throttle catches spam from a legitimately authenticated socket. Second, the rate-limit function takes the current timestamp as a parameter and stores its state in a weak map keyed by WebSocket, making it deterministic and straightforward to test. Third, the soft-versus-hard distinction is intentional: chat messages are silently dropped so the user simply retries, while a socket flood triggers a hard close.

---

## Result and Engine-Style Returns

Two parallel conventions handle the success-or-error case depending on context. The generic result type is the workhorse for parsing, validation, and lookups. Engine-style union returns are specialized for engine calls where success can carry several heterogeneous fields alongside the new state.

With the generic result type, you check whether the result succeeded, and if not you send the error and return early. If it succeeded, you dispatch the validated value. With the engine-style union, you check whether the result contains an error field; if it does, you return the error; if it does not, you read the new state — and potentially also movements, engine events, or transfer log entries that vary by action type.

The generic result type lives in the shared domain types module. Engine-style return shapes are defined per entry point in the shared engine folder.

Three considerations explain this design. First, the two shapes exist because of two distinct patterns: validators return a single success value, while engine entry points return state plus per-action extras that differ across actions. Unifying them would force every engine call into one enormous success type. Second, neither convention throws for validation failures — callers receive structured errors and can decide how to respond. Only the outer try-catch in the action runner catches unexpected bugs. Third, there is an implicit invariant: the narrowing check for the engine-style union works because no success shape contains an error field. Adding one would silently break narrowing, and a more explicit discriminant would be safer if the types grow.

---

## Cross-Pattern Flow

A single client-to-server message threads all these patterns in order.

First, the Worker-layer per-IP rate limits apply if the message arrives over an HTTP path. Second, the socket flood rate limit runs as stage zero. Third, JSON parsing produces an untyped result. Fourth, shape and size validation applies branded types and produces a typed client-to-server value. Fifth, the engine call runs against a cloned state with a random number generator, and either produces a list of engine events plus a new state, or returns an engine failure with an error code. Sixth, a server-to-client response is sent — either a state-bearing success or an error object carrying a code and message.

Each layer can reject independently. A developer tracing a bug from a wrong error surfacing to the user can walk the pipeline in one direction and find exactly which stage produced the unexpected result.
