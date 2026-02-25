# Infrastructure

AWS CDK v2 project that provisions the backend for the webapp.

All resources follow the naming convention `${name}-${environment}-${description}` (e.g. `techniverse-dev-user-pool`). The `name` (`"techniverse"`) is defined in `bin/infrastructure.ts` and passed to all nested stacks via props.

All domain stacks apply a `Domain` tag (e.g. `Domain: trading`) to all their resources via `cdk.Tags.of(this).add('Domain', '<domain-name>')` at the top of the constructor. This enables filtering and cost attribution by domain in AWS.

## DNS & Custom Domains

Route53 hosted zone `${name}.com.au` is looked up at synth time. Two pre-provisioned ACM certificates are imported by ARN in `bin/infrastructure.ts`:

- **CloudFront certificate** — must be in **us-east-1** (CloudFront requirement). Covers `${name}.com.au` and `*.${name}.com.au`. Used for CloudFront distributions and the edge-optimized API Gateway custom domain.
- **Regional certificate** — must be in **ap-southeast-2** (same region as the stack).

Domain names are environment-dependent:

| Resource | prod | non-prod (e.g. dev) |
|----------|------|---------------------|
| Webapp   | `trade.${name}.com.au` | `trade-${env}.${name}.com.au` |
| Website  | `${name}.com.au` | `site-${env}.${name}.com.au` |
| REST API | `api.${name}.com.au` | `api-${env}.${name}.com.au` |

Each stack (WebappStack, WebsiteStack, RestApiStack) creates its own Route53 A record (alias) pointing to its CloudFront distribution or API Gateway edge endpoint. DNS props are optional on all stacks to allow tests to run without a hosted zone.

The REST API is **edge-optimized** (`EndpointType.EDGE`), which deploys a CloudFront distribution in front of the API Gateway. This requires the ACM certificate to be in **us-east-1** (the CloudFront certificate).

## Commands

The `ENV` environment variable is required for all CDK commands.

```bash
ENV=prod npx cdk deploy

# Diff against deployed stack
ENV=prod npx cdk diff
```

## Lambda Defaults

All Lambda functions must set `memorySize: 256` (MB).

## Adding a New Domain Stack

1. Create `lib/domain-<name>.ts` using `NodejsFunction` pointing to the handler entry file.
2. Accept `name`, `api`, and `authorizer` via props; add `ANY` methods on the root resource and any sub-resources (e.g. `{id}`).
3. Add `cdk.Tags.of(this).add('Domain', '<name>')` at the top of the constructor to tag all resources with their domain.
4. Name resources using `${props.name}-${props.environment}-${description}` (e.g. `${props.name}-${props.environment}-<name>-handler`).
5. Wire the new stack in `bin/infrastructure.ts`, passing `name`, the REST API, and authorizer.
6. Add a test in `test/infrastructure.test.ts` asserting the Lambda is created.

## Adding a New Frontend Stack

1. Create `lib/<name>.ts` as a `cdk.NestedStack` with props containing `name: string` and `environment: string`.
2. Create a private S3 bucket (`BLOCK_ALL`, `DESTROY` removal policy, `autoDeleteObjects: true`), named `${props.name}-${props.environment}-<name>`.
3. Create a CloudFront distribution using `S3BucketOrigin.withOriginAccessControl()` (CDK auto-creates the OAC and bucket policy). Set `defaultRootObject: 'index.html'`, HTTPS redirect, and SPA error responses (403 + 404 → `/index.html` with 200).
4. Expose `bucket` and `distribution` as public readonly properties.
5. Wire the new stack in `bin/infrastructure.ts` passing `name` and environment.
6. Add JSDoc on all classes, interfaces, properties, and constructors.
