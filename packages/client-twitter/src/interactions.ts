import { SearchMode, Tweet } from "agent-twitter-client";
import * as fs from "fs";
import {
  composeContext,
  generateMessageResponse,
  generateShouldRespond,
  messageCompletionFooter,
  shouldRespondFooter,
  Content,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  ModelClass,
  State,
  stringToUuid,
  elizaLogger,
  getEmbeddingZeroVector,
  generateText,
  Character,
  Clients,
  ModelProviderName,
  getModel,
  embed,
} from "@elizaos/core";
import { ClientBase } from "./base";
import {
  buildConversationThread,
  cosineSimilarity,
  getWalrusDisplayUrl,
  postWalrus,
  sendTweet,
  wait,
} from "./utils.ts";
import {
  assetTemplate,
  scoreTemplate,
  similarityTemplate,
} from "./template.ts";
import { publishNewAsset } from "meme-coin-launchpad";
import OpenAI from "openai";
import sharp from "sharp";

export const twitterMessageHandlerTemplate =
  `
# Areas of Expertise
{{knowledge}}

# About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{providers}}

{{characterPostExamples}}

{{postDirections}}

Recent interactions between {{agentName}} and other users:
{{recentPostInteractions}}

{{recentPosts}}

# TASK: Generate a post/reply in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}) while using the thread of tweets as additional context:

Current Post:
{{currentPost}}

Thread of Tweets You Are Replying To:
{{formattedConversation}}

# INSTRUCTIONS: Generate a post in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}). You MUST include an action if the current post text includes a prompt that is similar to one of the available actions mentioned here:
{{actionNames}}
{{actions}}

Here is the current post text again. Remember to include an action if the current post text includes a prompt that asks for one of the available actions mentioned above (does not need to be exact)
{{currentPost}}
` + messageCompletionFooter;

export const twitterShouldRespondTemplate = (targetUsersStr: string) =>
  `# INSTRUCTIONS: Determine if {{agentName}} (@{{twitterUserName}}) should respond to the message and participate in the conversation. Do not comment. Just respond with "true" or "false".

Response options are RESPOND, IGNORE and STOP.

PRIORITY RULE: ALWAYS RESPOND to these users regardless of topic or message content: ${targetUsersStr}. Topic relevance should be ignored for these users.

For other users:
- {{agentName}} should RESPOND to messages directed at them
- {{agentName}} should RESPOND to conversations relevant to their background
- {{agentName}} should IGNORE irrelevant messages
- {{agentName}} should IGNORE very short messages unless directly addressed
- {{agentName}} should STOP if asked to stop
- {{agentName}} should STOP if conversation is concluded
- {{agentName}} is in a room with other users and wants to be conversational, but not annoying.

IMPORTANT:
- {{agentName}} (aka @{{twitterUserName}}) is particularly sensitive about being annoying, so if there is any doubt, it is better to IGNORE than to RESPOND.
- For users not in the priority list, {{agentName}} (@{{twitterUserName}}) should err on the side of IGNORE rather than RESPOND if in doubt.

Recent Posts:
{{recentPosts}}

Current Post:
{{currentPost}}

Thread of Tweets You Are Replying To:
{{formattedConversation}}

# INSTRUCTIONS: Respond with [RESPOND] if {{agentName}} should respond, or [IGNORE] if {{agentName}} should not respond to the last message and [STOP] if {{agentName}} should stop participating in the conversation.
` + shouldRespondFooter;

const wait429 = (ms = 1000) => new Promise((r) => setTimeout(r, ms));
export class TwitterInteractionClient {
  client: ClientBase;
  runtime: IAgentRuntime;
  constructor(client: ClientBase, runtime: IAgentRuntime) {
    this.client = client;
    this.runtime = runtime;
  }

  async start() {
    const handleTwitterInteractionsLoop = () => {
      this.handleTwitterInteractions();
      setTimeout(
        handleTwitterInteractionsLoop,
        // Defaults to 2 minutes
        this.client.twitterConfig.TWITTER_POLL_INTERVAL * 1000
      );
    };
    await this.client.cacheIsProcessingTweet(false);

    handleTwitterInteractionsLoop();
  }

  async handleTwitterInteractions() {
    if (await this.client.getIsProcessingTweet()) {
      elizaLogger.log("Already processing tweet, skipping");
      return;
    }
    await this.client.cacheIsProcessingTweet(true);
    elizaLogger.log("Checking Twitter interactions");

    const twitterUsername = this.client.profile.username;
    try {
      elizaLogger.log(
        "-----------------------------------------------------------------"
      );
      // Check for mentions
      const mentionCandidates = (
        await this.client.fetchSearchTweets(
          `@${twitterUsername}`,
          40,
          SearchMode.Latest
        )
      ).tweets;
      elizaLogger.log(twitterUsername, "twitterUsername");
      elizaLogger.log(
        "Completed checking mentioned tweets:",
        mentionCandidates.length
      );
      //   let uniqueTweetCandidates = [...mentionCandidates];
      //   // Only process target users if configured
      //   if (this.client.twitterConfig.TWITTER_TARGET_USERS.length) {
      //     const TARGET_USERS = this.client.twitterConfig.TWITTER_TARGET_USERS;

      //     elizaLogger.log("Processing target users:", TARGET_USERS);

      //     if (TARGET_USERS.length > 0) {
      //       // Create a map to store tweets by user
      //       const tweetsByUser = new Map<string, Tweet[]>();

      //       // Fetch tweets from all target users
      //       for (const username of TARGET_USERS) {
      //         try {
      //           const userTweets = (
      //             await this.client.twitterClient.fetchSearchTweets(
      //               `from:${username}`,
      //               3,
      //               SearchMode.Latest
      //             )
      //           ).tweets;

      //           // Filter for unprocessed, non-reply, recent tweets
      //           const validTweets = userTweets.filter((tweet) => {
      //             const isUnprocessed =
      //               !this.client.lastCheckedTweetId ||
      //               parseInt(tweet.id) > this.client.lastCheckedTweetId;
      //             const isRecent =
      //               Date.now() - tweet.timestamp * 1000 < 2 * 60 * 60 * 1000;

      //             elizaLogger.log(`Tweet ${tweet.id} checks:`, {
      //               isUnprocessed,
      //               isRecent,
      //               isReply: tweet.isReply,
      //               isRetweet: tweet.isRetweet,
      //             });

      //             return (
      //               isUnprocessed &&
      //               !tweet.isReply &&
      //               !tweet.isRetweet &&
      //               isRecent
      //             );
      //           });

      //           if (validTweets.length > 0) {
      //             tweetsByUser.set(username, validTweets);
      //             elizaLogger.log(
      //               `Found ${validTweets.length} valid tweets from ${username}`
      //             );
      //           }
      //         } catch (error) {
      //           elizaLogger.error(
      //             `Error fetching tweets for ${username}:`,
      //             error
      //           );
      //           continue;
      //         }
      //       }

      //       // Select one tweet from each user that has tweets
      //       const selectedTweets: Tweet[] = [];
      //       for (const [username, tweets] of tweetsByUser) {
      //         if (tweets.length > 0) {
      //           // Randomly select one tweet from this user
      //           const randomTweet =
      //             tweets[Math.floor(Math.random() * tweets.length)];
      //           selectedTweets.push(randomTweet);
      //           elizaLogger.log(
      //             `Selected tweet from ${username}: ${randomTweet.text?.substring(
      //               0,
      //               100
      //             )}`
      //           );
      //         }
      //       }

      //       // Add selected tweets to candidates
      //       uniqueTweetCandidates = [...mentionCandidates, ...selectedTweets];
      //     }
      //   } else {
      //     elizaLogger.log("No target users configured, processing only mentions");
      //   }

      //   // Sort tweet candidates by ID in ascending order
      //   uniqueTweetCandidates
      //     .sort((a, b) => a.id.localeCompare(b.id))
      //     .filter((tweet) => tweet.userId !== this.client.profile.id);

      mentionCandidates
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter((tweet) => tweet.userId !== this.client.profile.id);

      // for each tweet candidate, handle the tweet
      for (const tweet of mentionCandidates) {
        if (
          !this.client.lastCheckedTweetId ||
          BigInt(tweet.id) > this.client.lastCheckedTweetId
        ) {
          if (tweet.isReply || tweet.isRetweet) {
            elizaLogger.log(
              `Skipping tweet ${tweet.id} as it is a reply or retweet`
            );
            continue;
          }
          // Generate the tweetId UUID the same way it's done in handleTweet
          const tweetId = stringToUuid(tweet.id + "-" + this.runtime.agentId);
          elizaLogger.log("Checking tweet", tweet.id);
          // Check if we've already processed this tweet
          const existingResponse =
            await this.runtime.messageManager.getMemoryById(tweetId);

          if (existingResponse) {
            elizaLogger.log(`Already responded to tweet ${tweet.id}, skipping`);
            continue;
          }
          elizaLogger.log("New Tweet found", tweet.permanentUrl);

          const roomId = stringToUuid(
            tweet.conversationId + "-" + this.runtime.agentId
          );

          const userIdUUID =
            tweet.userId === this.client.profile.id
              ? this.runtime.agentId
              : stringToUuid(tweet.userId!);

          await this.runtime.ensureConnection(
            userIdUUID,
            roomId,
            tweet.username,
            tweet.name,
            "twitter"
          );

          elizaLogger.log("Ensured connection for tweet", tweet.id);
          // Build the conversation thread for the tweet // create memory for each tweet in the thread
          const thread = await buildConversationThread(tweet, this.client);

          const message = {
            content: { text: tweet.text },
            agentId: this.runtime.agentId,
            userId: userIdUUID,
            roomId,
          };

          elizaLogger.log(tweet, "tweet");
          elizaLogger.log(message, "message");

          await this.handleTweet({
            tweet,
            message,
            thread,
            // thread: [tweet],
          });

          // Update the last checked tweet ID after processing each tweet
          this.client.lastCheckedTweetId = BigInt(tweet.id);
        }
      }

      // Save the latest checked tweet ID to the file
      await this.client.cacheLatestCheckedTweetId();
      await this.client.cacheIsProcessingTweet(false);
      elizaLogger.log("Finished checking Twitter interactions");
    } catch (error) {
      await this.client.cacheIsProcessingTweet(false);
      elizaLogger.error("Error handling Twitter interactions:", error);
    }
  }

  private async handleTweet({
    tweet,
    message,
    thread,
  }: {
    tweet: Tweet;
    message: Memory;
    thread: Tweet[];
  }) {
    elizaLogger.log(
      JSON.parse(
        JSON.stringify({
          id:
            "asset" +
            stringToUuid(tweet.id + "-" + this.runtime.agentId).slice(5),
          type: "asset",
          content: {
            text: "",
            symbol: "",
            assetName: "",
            tweetId: "",
            mintPrice: 0,
            iconUrl: "",
            description: "",
            posterAddress: "",
            tokenUrl: "",
          },
          embedding: [],
          roomId: stringToUuid(
            tweet.conversationId + "-" + this.runtime.agentId
          ),
          userId: stringToUuid(tweet.userId as string),
          agentId: this.runtime.agentId,
          unique: 1,
        })
      )
    );

    if (tweet.userId === this.client.profile.id) {
      // Skip processing if the tweet is from the bot itself
      return;
    }

    if (!message.content.text) {
      elizaLogger.log("Skipping Tweet with no text", tweet.id);
      return { text: "", action: "IGNORE" };
    }

    elizaLogger.log("Processing Tweet: ", tweet.id);

    const formattedConversation = thread
      .map(
        (tweet) => `@${tweet.username} (${new Date(
          tweet.timestamp * 1000
        ).toLocaleString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          month: "short",
          day: "numeric",
        })}):
        ${tweet.text}`
      )
      .join("\n\n");

    elizaLogger.log("formattedConversation: ", formattedConversation);

    const addressRegex = /0x[a-fA-F0-9]{64}/;
    const posterAddress = tweet.text.match(addressRegex)?.[0];
    const tweetWithoutAddress = tweet.text.replace(addressRegex, "").trim();
    const mentionRegex = `@${this.client.twitterConfig.TWITTER_USERNAME}`;

    const tweetWithoutMentionAndAddress = tweetWithoutAddress
      .replace(mentionRegex, "")
      .trim();

    const embedding = await embed(this.runtime, tweetWithoutMentionAndAddress);

    let state = await this.runtime.composeState(message, {
      twitterClient: this.client.twitterClient,
      twitterUserName: this.client.twitterConfig.TWITTER_USERNAME,
      currentPost: tweetWithoutMentionAndAddress,
      formattedConversation,
      embedding,
    });

    //// #### Save the tweet as a memory
    // check if the tweet exists, save if it doesn't
    const tweetId = stringToUuid(tweet.id + "-" + this.runtime.agentId);
    elizaLogger.log("Checking if tweet exists", tweetId);

    elizaLogger.log("Tweet without ", tweetWithoutMentionAndAddress);

    const similarMemories =
      (await this.searchMemoriesByEmbedding(embedding)) || [];
    const maxSimilarityPost = similarMemories.reduce((prev, current) =>
      prev.similarity > current.similarity ? prev : current
    );

    let response;
    let mintedTemplate;
    let shouldPublish;
    let tokenUrl;
    let mintPool;
    let iconUrl;
    let symbol;
    let asset_name;
    let description;
    let iconPrompt;
    let mintPrice;
    let context;
    const stringId = stringToUuid(tweet.id + "-" + this.runtime.agentId);

    if (Number(maxSimilarityPost.similarity ?? 0) > 0.9) {
      elizaLogger.log("Found similar post", maxSimilarityPost);
      context = composeContext({
        state: {
          ...state,
          similarPost: maxSimilarityPost.text,
        },
        template: similarityTemplate,
      });
      const text = await generateText({
        runtime: this.runtime,
        context,
        modelClass: ModelClass.LARGE,
      });
      response = {
        text,
        action: "NONE",
        inReplyTo: stringId,
      };
    } else {
      const scoreContext = composeContext({
        state,
        template: scoreTemplate,
      });
      context = scoreContext;
      let score: number | string;
      let comment = "";
      let times = 0;
      while (isNaN(Number(score)) && times < 3) {
        try {
          await wait429(1000);
          const response = await generateText({
            runtime: this.runtime,
            context: scoreContext,
            modelClass: ModelClass.LARGE,
          });
          elizaLogger.log("Response: ", response);
          const result = JSON.parse(response);
          score = result.score;
          comment = result.comment;
          elizaLogger.log("score: ", score);
        } catch (e) {
          elizaLogger.error("Error generating score: ", e);
        }
        times++;
      }

      if (times >= 3) {
        elizaLogger.error("Failed to generate score");
        return { text: "Failed to generate score", action: "IGNORE" };
      }

      shouldPublish = Number(score) > 7 && Boolean(posterAddress);
      if (shouldPublish) {
        const assetContext = composeContext({
          state,
          template: assetTemplate,
        });
        let times = 0;
        let imageBase64;
        while (!Boolean(symbol) && times < 5) {
          try {
            await wait429(1000);
            const response = await generateText({
              runtime: this.runtime,
              context: assetContext,
              modelClass: ModelClass.LARGE,
            });
            const responseText = response.replace(/`/g, "").replace("json", "");
            elizaLogger.log("Asset Response: ", responseText);
            const result = JSON.parse(responseText);
            elizaLogger.log("Asset Response: ", result);
            symbol = result.symbol;
            asset_name = result.asset_name;
            description = result.description;
            iconPrompt = result.iconPrompt;
            mintPrice = result.mintPrice;

            imageBase64 = await this.generateImage({
              prompt: `logo for ${iconPrompt}`,
              width: 512,
              height: 512,
              count: 1,
            });
          } catch (e) {
            elizaLogger.error("Error generating asset or image: ", e);
          }
          times++;
        }
        if (!Boolean(symbol)) {
          throw new Error("Failed to generate asset");
        }

        elizaLogger.log("metadata: ", {
          symbol,
          asset_name,
          description,
          iconPrompt,
        });

        elizaLogger.log(
          "Generated Image URL: ",
          imageBase64.data[0]?.slice(0, 100)
        );
        // walrus

        const base64Data = imageBase64.data[0].replace(
          /^data:image\/\w+;base64,/,
          ""
        );

        const buffer = Buffer.from(base64Data, "base64");

        // const buffer = await sharp(largeBuffer)
        //   .resize(512, 512, {
        //     position: "center",
        //   })
        //   .toBuffer();

        // save image to image.png
        fs.writeFileSync("image.png", buffer);

        const walrusResponse = await postWalrus({
          content: buffer,
          type: "image/png",
          query: "epochs=5",
        });

        const blobId =
          walrusResponse?.alreadyCertified?.blobId ||
          walrusResponse?.newlyCreated?.blobObject?.blobId;

        elizaLogger.log("Walrus Response: ", walrusResponse);

        const moduleName = symbol.toLowerCase();
        const totalSupply = 100000000000; // 100 billion
        const decimals = 2;
        iconUrl = getWalrusDisplayUrl(blobId);
        const owner_owned_amount = 1000000000; //0.1% of total supply
        elizaLogger.log(
          "Params",
          moduleName, //moduleName
          totalSupply.toString(), //total supply
          decimals.toString(), //decimals
          symbol, //symbol
          asset_name, //asset name
          description, //description
          iconUrl, //iconUrl
          (Number(mintPrice) * Math.pow(10, 7)).toString(), //mint price sui decimal / decimals
          posterAddress, //owner
          owner_owned_amount.toString() //owner owned amount
        );
        const result = await publishNewAsset(
          moduleName, //moduleName
          totalSupply.toString(), //total supply
          decimals.toString(), //decimals
          symbol, //symbol
          asset_name, //asset name
          description, //description
          iconUrl, //iconUrl
          (Number(mintPrice) * Math.pow(10, 7)).toString(), //mint price sui decimal / decimals
          posterAddress, //owner
          owner_owned_amount.toString() //owner owned amount
        );
        elizaLogger.log("Publish Asset Result: ", result);
        const coinType = result?.balanceChanges?.find(
          (c) => c.coinType !== "0x2::sui::SUI"
        )?.coinType;

        mintPool = result?.objectChanges?.find((c) => {
          if (!c.objectType) return false;
          const splitObjectType = c.objectType?.split("::");
          return splitObjectType?.[splitObjectType?.length - 1] === "MintPool";
        })?.objectId;

        tokenUrl = `https://testnet.suivision.xyz/coin/${coinType}`;

        mintedTemplate = `
This joke has been published as an token on the Sui blockchain!
${symbol} (${asset_name})
${tokenUrl}
`;
      }

      //save for mint website

      if (shouldPublish && mintPool) {
        await this.savePublishedAsset({
          id:
            "asset" +
            stringToUuid(tweet.id + "-" + this.runtime.agentId).slice(5),
          type: "asset",
          content: {
            text: tweetWithoutMentionAndAddress,
            symbol,
            assetName: asset_name,
            tweetId: tweet.id,
            mintPrice,
            iconUrl,
            description,
            posterAddress,
            tokenUrl,
            mintPool,
          },
          roomId: stringToUuid(
            tweet.conversationId + "-" + this.runtime.agentId
          ),
          userId: stringToUuid(tweet.userId as string),
          agentId: this.runtime.agentId,
          unique: 1,
        });
      }

      response = {
        text: comment,
        action: "NONE",
        inReplyTo: stringId,
      };
    }

    const removeQuotes = (str: string) => str.replace(/^['"](.*)['"]$/, "$1");

    response.text = removeQuotes(response.text);
    elizaLogger.log("Last Response: ", response);

    const tweetExists = await this.runtime.messageManager.getMemoryById(
      tweetId
    );

    if (!tweetExists) {
      elizaLogger.log("tweet does not exist, saving");
      const userIdUUID = stringToUuid(tweet.userId as string);
      const roomId = stringToUuid(tweet.conversationId);

      const message = {
        id: tweetId,
        agentId: this.runtime.agentId,
        content: {
          text: tweetWithoutMentionAndAddress,
          url: tweet.permanentUrl,
          inReplyTo: tweet.inReplyToStatusId
            ? stringToUuid(tweet.inReplyToStatusId + "-" + this.runtime.agentId)
            : undefined,
        },
        userId: userIdUUID,
        roomId,
        createdAt: tweet.timestamp * 1000,
      };
      await this.client.saveRequestMessage(message, state);
    }

    // #### Save the response as a memory
    if (response.text) {
      try {
        const callback: HandlerCallback = async (response: Content) => {
          const memories = await sendTweet(
            this.client,
            response,
            message.roomId,
            this.client.twitterConfig.TWITTER_USERNAME,
            tweet.id
          );
          return memories;
        };

        let responseMessages = await callback(response);

        if (shouldPublish) {
          const mintedResponseMessages = await callback({
            attachments: [
              {
                id: stringToUuid("icon-" + this.runtime.agentId),
                url: iconUrl,
                title: symbol,
                description,
                source: iconUrl,
                text: `Icon for ${symbol}`,
                contentType: "image/png",
              },
            ],
            text: mintedTemplate,
            action: "NONE",
            inReplyTo: stringId,
          });
          responseMessages = [...responseMessages, ...mintedResponseMessages];
        }

        state = (await this.runtime.updateRecentMessageState(state)) as State;

        const responseInfo = `Context:\n\n${context}\n\nSelected Post: ${tweet.id} - ${tweet.username}: ${tweetWithoutMentionAndAddress}\nAgent's Output:\n${response.text}`;

        await this.runtime.cacheManager.set(
          `twitter/tweet_generation_${tweet.id}.txt`,
          responseInfo
        );
        await wait();
      } catch (error) {
        elizaLogger.error(`Error sending response tweet: ${error}`);
      }
    }
  }

  async buildConversationThread(
    tweet: Tweet,
    maxReplies: number = 10
  ): Promise<Tweet[]> {
    const thread: Tweet[] = [];
    const visited: Set<string> = new Set();

    async function processThread(currentTweet: Tweet, depth: number = 0) {
      elizaLogger.log("Processing tweet:", {
        id: currentTweet.id,
        inReplyToStatusId: currentTweet.inReplyToStatusId,
        depth: depth,
      });

      if (!currentTweet) {
        elizaLogger.log("No current tweet found for thread building");
        return;
      }

      if (depth >= maxReplies) {
        elizaLogger.log("Reached maximum reply depth", depth);
        return;
      }

      // Handle memory storage
      const memory = await this.runtime.messageManager.getMemoryById(
        stringToUuid(currentTweet.id + "-" + this.runtime.agentId)
      );
      if (!memory) {
        const roomId = stringToUuid(
          currentTweet.conversationId + "-" + this.runtime.agentId
        );
        const userId = stringToUuid(currentTweet.userId);

        await this.runtime.ensureConnection(
          userId,
          roomId,
          currentTweet.username,
          currentTweet.name,
          "twitter"
        );

        //// ### Save the tweet as a memory
        // this.runtime.messageManager.createMemory({
        //   id: stringToUuid(currentTweet.id + "-" + this.runtime.agentId),
        //   agentId: this.runtime.agentId,
        //   content: {
        //     text: currentTweet.text,
        //     source: "twitter",
        //     url: currentTweet.permanentUrl,
        //     inReplyTo: currentTweet.inReplyToStatusId
        //       ? stringToUuid(
        //           currentTweet.inReplyToStatusId + "-" + this.runtime.agentId
        //         )
        //       : undefined,
        //   },
        //   createdAt: currentTweet.timestamp * 1000,
        //   roomId,
        //   userId:
        //     currentTweet.userId === this.twitterUserId
        //       ? this.runtime.agentId
        //       : stringToUuid(currentTweet.userId),
        //   embedding: getEmbeddingZeroVector(),
        // });
      }

      if (visited.has(currentTweet.id)) {
        elizaLogger.log("Already visited tweet:", currentTweet.id);
        return;
      }

      visited.add(currentTweet.id);
      thread.unshift(currentTweet);

      elizaLogger.debug("Current thread state:", {
        length: thread.length,
        currentDepth: depth,
        tweetId: currentTweet.id,
      });

      if (currentTweet.inReplyToStatusId) {
        elizaLogger.log(
          "Fetching parent tweet:",
          currentTweet.inReplyToStatusId
        );
        try {
          const parentTweet = await this.twitterClient.getTweet(
            currentTweet.inReplyToStatusId
          );

          if (parentTweet) {
            elizaLogger.log("Found parent tweet:", {
              id: parentTweet.id,
              text: parentTweet.text?.slice(0, 50),
            });
            await processThread(parentTweet, depth + 1);
          } else {
            elizaLogger.log(
              "No parent tweet found for:",
              currentTweet.inReplyToStatusId
            );
          }
        } catch (error) {
          elizaLogger.log("Error fetching parent tweet:", {
            tweetId: currentTweet.inReplyToStatusId,
            error,
          });
        }
      } else {
        elizaLogger.log("Reached end of reply chain at:", currentTweet.id);
      }
    }

    // Need to bind this context for the inner function
    await processThread.bind(this)(tweet, 0);

    elizaLogger.debug("Final thread built:", {
      totalTweets: thread.length,
      tweetIds: thread.map((t) => ({
        id: t.id,
        text: t.text?.slice(0, 50),
      })),
    });

    return thread;
  }

  private async generateImage(data: {
    prompt: string;
    width: number;
    height: number;
    count?: number;
    negativePrompt?: string;
    numIterations?: number;
    guidanceScale?: number;
    seed?: number;
    modelId?: string;
    jobId?: string;
    stylePreset?: string;
    hideWatermark?: boolean;
  }) {
    const model = getModel(this.runtime.imageModelProvider, ModelClass.IMAGE);
    const targetSize = `${data.width}x${data.height}`;

    const openaiApiKey = this.runtime.getSetting("OPENAI_API_KEY") as string;
    if (!openaiApiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    const openai = new OpenAI({
      apiKey: openaiApiKey as string,
    });
    const response = await openai.images.generate({
      model,
      prompt: data.prompt,
      size: targetSize as
        | "256x256"
        | "512x512"
        | "1024x1024"
        | "1792x1024"
        | "1024x1792",
      n: data.count,
      response_format: "b64_json",
    });
    const base64s = response.data.map(
      (image) => `data:image/png;base64,${image.b64_json}`
    );
    return { success: true, data: base64s };
  }

  private async searchMemoriesByEmbedding(embedding: number[]): Promise<
    {
      text: string;
      similarity: number;
    }[]
  > {
    const db = this.runtime.databaseAdapter.db;
    const memories = await db.prepare("SELECT * FROM memories").all();
    const similarities = memories.map((memory) => {
      const memoryEmbedding: number[] = Array.from(
        new Float32Array(memory.embedding.buffer)
      );

      if (embedding.length !== memoryEmbedding.length) {
        return {
          text: memory.text,
          similarity: 0,
        };
      }

      return {
        text: memory.content.text,
        similarity: cosineSimilarity(embedding, memoryEmbedding),
      };
    });

    return similarities;
  }

  private async savePublishedAsset(params: {
    id: string;
    type: string;
    content: {
      text: string;
      symbol: string;
      assetName: string;
      tweetId: string;
      mintPrice: number;
      iconUrl: string;
      description: string;
      posterAddress: string;
      tokenUrl: string;
      mintPool: string;
    };
    userId: string;
    roomId: string;
    agentId: string;
    unique: number;
  }) {
    const db = this.runtime.databaseAdapter.db;
    elizaLogger.log("Saving asset", params);
    try {
      await db
        .prepare(
          `INSERT INTO memories (id, type, createdAt, content, embedding, userId, roomId, agentId, "unique") VALUES (?, ?, ?, ?, X'', ?, ?, ?, ?)`
        )
        .run(
          params.id,
          "asset",
          Date.now(),
          JSON.stringify(params.content),
          params.userId,
          params.roomId,
          params.agentId,
          params.unique
        );
    } catch (e) {
      elizaLogger.error("Error saving asset: ", e);
    }
  }
}
