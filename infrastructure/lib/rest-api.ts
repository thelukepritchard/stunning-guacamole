import * as cdk from 'aws-cdk-lib/core';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';

/** Props for {@link RestApiStack}. */
export interface RestApiStackProps extends cdk.NestedStackProps {

  /** Project name prefix for resource naming. */
  name: string;

  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;

  /** Cognito User Pool to back the API authorizer. */
  userPool: cognito.IUserPool;

  /** Custom domain name for the API (e.g. 'api.techniverse.com.au'). */
  domainName?: string;

  /** ACM certificate covering the custom domain (must be in the same region as the API). */
  certificate?: acm.ICertificate;

  /** Route53 hosted zone for creating DNS records. */
  hostedZone?: route53.IHostedZone;
}

/**
 * REST API Gateway stack with Cognito authorization.
 *
 * Creates an API Gateway REST API and a Cognito User Pools authorizer
 * that domain stacks can attach resources to.
 */
export class RestApiStack extends cdk.NestedStack {

  /** The API Gateway REST API. */
  public readonly api: apigateway.RestApi;

  /** The Cognito authorizer for protecting API methods. */
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: RestApiStackProps) {
    super(scope, id, props);

    this.api = new apigateway.RestApi(this, 'DomainRestApi', {
      restApiName: `${props.name}-${props.environment}-domain-rest-api`,
      endpointTypes: [apigateway.EndpointType.EDGE],
    });

    this.authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      authorizerName: `${props.name}-${props.environment}-cognito-authorizer`,
      cognitoUserPools: [props.userPool],
    });

    if (props.domainName && props.certificate) {
      /** Custom domain name for the REST API. */
      const domain = this.api.addDomainName('CustomDomain', {
        domainName: props.domainName,
        certificate: props.certificate,
        endpointType: apigateway.EndpointType.EDGE,
      });

      if (props.hostedZone) {
        /** Route53 A record aliasing the custom domain to the API Gateway regional endpoint. */
        new route53.ARecord(this, 'ApiARecord', {
          zone: props.hostedZone,
          recordName: props.domainName,
          target: route53.RecordTarget.fromAlias(
            new targets.ApiGatewayDomain(domain),
          ),
        });
      }
    }
  }
}
