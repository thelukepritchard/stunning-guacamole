import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

/** Props for {@link WebsiteStack}. */
export interface WebsiteStackProps extends cdk.NestedStackProps {

  /** Deployment environment name (e.g. 'dev', 'prod'). */
  environment: string;
}

/**
 * Website frontend stack.
 *
 * Creates an S3 bucket and CloudFront distribution to serve the
 * public marketing site. The bucket is private and accessed
 * exclusively through CloudFront via Origin Access Control.
 */
export class WebsiteStack extends cdk.NestedStack {

  /** The S3 bucket hosting the website static assets. */
  public readonly bucket: s3.Bucket;

  /** The CloudFront distribution serving the website. */
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebsiteStackProps) {
    super(scope, id, props);

    this.bucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `website-${props.environment}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.distribution = new cloudfront.Distribution(this, 'WebsiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
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
  }
}
