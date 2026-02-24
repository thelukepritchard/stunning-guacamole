import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';

/** Props for {@link WebappStack}. */
export interface WebappStackProps extends cdk.NestedStackProps {

  /** Project name prefix for resource naming. */
  name: string;

  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;

  /** Custom domain name for the webapp (e.g. 'trade.techniverse.com.au'). */
  domainName?: string;

  /** ACM certificate covering the custom domain (must be in us-east-1 for CloudFront). */
  certificate?: acm.ICertificate;

  /** Route53 hosted zone for creating DNS records. */
  hostedZone?: route53.IHostedZone;
}

/**
 * Webapp frontend stack.
 *
 * Creates an S3 bucket and CloudFront distribution to serve the
 * authenticated dashboard application. The bucket is private and
 * accessed exclusively through CloudFront via Origin Access Control.
 */
export class WebappStack extends cdk.NestedStack {

  /** The S3 bucket hosting the webapp static assets. */
  public readonly bucket: s3.Bucket;

  /** The CloudFront distribution serving the webapp. */
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebappStackProps) {
    super(scope, id, props);

    this.bucket = new s3.Bucket(this, 'WebappBucket', {
      bucketName: `${props.name}-${props.environment}-webapp`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.distribution = new cloudfront.Distribution(this, 'WebappDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
      ...(props.domainName && props.certificate ? {
        domainNames: [props.domainName],
        certificate: props.certificate,
      } : {}),
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    if (props.domainName && props.hostedZone) {
      /** Route53 A record aliasing the custom domain to the CloudFront distribution. */
      new route53.ARecord(this, 'WebappARecord', {
        zone: props.hostedZone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(this.distribution),
        ),
      });
    }
  }
}
