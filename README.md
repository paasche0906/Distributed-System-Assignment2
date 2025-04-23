# Distributed-System-Assignment2
## Distributed Systems - Event-Driven Architecture.

__Name:__ Jiacheng Pan

__Demo__: ....URL of YouTube demo ......

This repository contains the implementation of a skeleton design for an application that manages a photo gallery, illustrated below. The app uses an event-driven architecture and is deployed on the AWS platform using the CDK framework for infrastructure provisioning.

![!\[\](./testfiles/arch.png)](photo-library-app/testfiles/arch.jpg)

### Code Status. 

__Feature:__
+ Photographer:
  + Log new Images - Completed & Tested
  + Metadata updating - Completed & Tested
  + Invalid image removal - Completed & Tested
  + Status Update Mailer - Completed & Tested
+ Moderator
  + Status updating - Completed & Tested
  + Filtering - Completed & Verified via CloudWatch Logs
  + Messaging - Completed & Triggered downstream functions


### Testing Steps 
1. Upload Valid Image
```bash
$ aws s3 cp ./testfiles/sunflower.jpeg s3://photolibraryappstack-photogallerybucket51200357-tt1imfqtxnoasd
```
2. Upload Invalid Image
```bash
$ aws s3 cp ./testfiles/arch.jpg s3://photolibraryappstack-photogallerybucket51200357-tt1imfqtxnoasd
```
3. Add Metadata
```bash
$ aws sns publish --topic-arn "arn:aws:sns:eu-west-1:585768165910:PhotoLibraryAppStack-MetadataTopicA4CB8975-WP94tVA2H2uT" --message-attributes file://attributes.json --message file://message.json
```
4. Moderator Updates Status
```bash
$ aws sns publish --topic-arn "arn:aws:sns:eu-west-1:585768165910:PhotoLibraryAppStack-MetadataTopicA4CB8975-WP94tVA2H2uT" --message file://status-message.json --message-attributes file://attributes.json
```
5. Email Notification Sent
6. SNS Filtering

| Scenario         | Message Type | Triggered Lambda              |
|------------------|--------------|-------------------------------|
| Metadata message | `"metadata"` | `AddMetadataFunction` only    |
| Status message   | `"status"`   | `UpdateStatusFunction` only   |
| Notify message   | `"notify"`   | `SendStatusEmailFunction` only |

