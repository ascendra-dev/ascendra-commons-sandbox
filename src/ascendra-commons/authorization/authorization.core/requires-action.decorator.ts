import { SetMetadata } from '@nestjs/common';

export const ACTION_METADATA_KEY = 'authorization:action';
export const NO_ACTION_REQUIRED_KEY = 'authorization:no-action-required';

/**
 * One action per state-changing endpoint, declared once via decorator and
 * checked by AuthorizationGuard before the handler runs — not a manual
 * `if (!can(...))` remembered (or forgotten) per handler.
 *
 * Works on a method or a whole controller class; a method-level declaration
 * wins over a class-level one.
 */
export const RequiresAction = (action: string) => SetMetadata(ACTION_METADATA_KEY, action);

/**
 * Marks an endpoint (or a whole controller) as intentionally *not* action-gated
 * — AuthorizationGuard lets it through without any `can()` check.
 *
 * This exists because the guard is **deny-by-default**: an endpoint under the
 * guard with neither `@RequiresAction()` nor `@NoActionRequired()` is a
 * configuration error and the guard throws, rather than silently letting it
 * through. That is the whole point — a new state-changing endpoint where the
 * author forgot `@RequiresAction()` must not ship open. So every genuinely
 * open endpoint (a health check, a login route, a public payment-link view, a
 * webhook receiver) has to say so out loud with this decorator.
 *
 * "No action required" is not the same as "no authentication required" — this
 * only tells *this* guard to skip the permission check. Whether an
 * unauthenticated caller is allowed at all is the consuming project's own
 * authentication guard's decision, a separate concern (see this module's
 * README).
 */
export const NoActionRequired = () => SetMetadata(NO_ACTION_REQUIRED_KEY, true);
