import { applyDecorators, SetMetadata } from '@nestjs/common';
import { NoActionRequired } from '../ascendra-commons/authorization/authorization.core';

export const IS_PUBLIC_KEY = 'sandbox:isPublic';

/** No sign-in and no action needed — skips both DevAuthGuard and the vendored AuthorizationGuard. */
export const Public = () => applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), NoActionRequired());
