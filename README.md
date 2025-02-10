# Jokepapa AI Agent

## 1. Read post and check for joke duplication

Agent reads following post

```
Dogs can't operate MRI machines. But catscan. //joke
@BobAndAliceSui //must mention
	
0xea466dd05f1cea0a20b23f353c1eb61fa9e25b4c7b340854a19fa9224a93e8b 
//must have addressf
```

If a post has a high cosine similarity to any existing post in the embedding data, it should be considered duplicated.
Then generating with this reply template

```
# About the Agent:  
- **Agent Name**: {{agentName}} (@{{twitterUserName}})  
- **Bio**: {{bio}}  
- **Lore**: {{lore}}  
- **Topics of Interest**: {{topics}}  
- **Areas of Expertise**: {{knowledge}}  

### Current Post:  
{{currentPost}}

This post is similar to the following recent post
{{similarPost}}

# TASK: Give it a reply about the joke has been posted duplicated.

## Instructions:
- Output the reply as a plain string. No JSON or additional formatting is needed.
```

## 2. Generate score and comment

Ask GPT for score and comment ( prompting template )

```
# Dad Joke Judge Agent Template  

# About the Agent:  
- **Agent Name**: {{agentName}} (@{{twitterUserName}})  
- **Bio**: {{bio}}  
- **Lore**: {{lore}}  
- **Topics of Interest**: {{topics}}  
- **Areas of Expertise**: {{knowledge}}  

# Character Style and Personality:  
- {{agentName}} is a playful, pun-loving dad joke enthusiast who delights in humor and has a sharp eye for spotting true dad jokes.  
- Known for their witty yet fair judging style, {{agentName}} adds a touch of personality to every score.  
- {{agentName}} is never harsh but does not hesitate to give constructive feedback for jokes that miss the mark.  

# Agent’s Recent Interactions:  
{{recentPostInteractions}}  
{{recentPosts}}  

# Joke Scoring Criteria:
{{jokeScoringCriteria}}

# TASK: Determine if the message is a joke and rate it in the voice, style, and perspective of {{agentName}} (@{{twitterUserName}}).  

## Scoring Criteria:  
1. **If it is a dad joke**:  
   - Rate the joke on a scale of **0 to 10**.  

### Current Post:  
{{currentPost}}

### Thread of Tweets You Are Replying To:  
{{formattedConversation}}  

# INSTRUCTIONS:  

- Identify if the post is a joke.  
- Assign a score and provide a short, in-character comment.  
- Use the JSON format below for your response:  

{  
  "comment": string,  
  "score": number,
}
```

Get response after prompting:

```json
 {  
    "comment": "Now that’s a dad joke with a purr-fect punchline! I see what you did there—mixing canines and felines in a way that even a crypto trader could appreciate. I’ll give it a solid 8 for cleverness and execution. Just don’t let it get too stale, or it might end up as a rug pull in the joke world.",  
    "score": 8,
  } 
```

## 3. Publish Token ( If score > 7 )

Ask GPT for prompting asset metadata ( prompting template )

```

# Dad Joke Judge Agent Template  

# About the Agent:  
- **Agent Name**: {{agentName}} (@{{twitterUserName}})  
- **Bio**: {{bio}}  
- **Lore**: {{lore}}  
- **Topics of Interest**: {{topics}}  
- **Areas of Expertise**: {{knowledge}}  


# Agent’s Recent Interactions:  
{{recentPostInteractions}}  
{{recentPosts}}

# TASK: Generate an token metadata based on the current post.  

### Current Post:  
{{currentPost}}  

### Thread of Tweets You Are Replying To:  
{{formattedConversation}}

### Response Column:
- asset_name: It is the name of the asset.
- symbol: It is symbol based on the asset name.
- description: It is for the description of the asset.
- iconPrompt: Based on the token name/symbol/description to generate a token image, and please DO NOT include too many detail better in a clear shape of iconic object.
- mintPrice: It is the price of the minting token. range: (0.0000001-0.0001)

## Instructions:  

- Use the JSON format below for your response:  

{
  "symbol": string,
  "asset_name": string,
  "description": string,
  "iconPrompt": string,
  "mintPrice": number,
}
```

Get response after prompting:

```json
{
  "symbol": "CATSCAN",
  "asset_name": "Mediocre Joke Token",
  "description": "This token represents the hilariously underwhelming punchline about dogs and MRI machines, with a feline twist that leaves everyone questioning their life choices. Perfect for those who appreciate humor that lands like a bad rug pull.",
  "iconPrompt": "A cartoon dog looking confused in front of an MRI machine, with a smug cat lounging nearby holding a sign that says 'Catscan'. The background features a whimsical hospital setting with exaggerated medical equipment.",
  "mintPrice": "0.0001"
}
```

Then generate image with metadata:

```jsx
const imageUrl = await generateImage(
 {
  prompt: `logo for ${iconPrompt}`,
  width: 512,
  height: 512,
  count: 1,
 },
	this.runtime
);
```

Then publishing image to Walrus

## 4. Reply with different character (optional)

Ask GPT for replying ( prompting template )

```
# Dad Joke Judge Agent Template  

# About the Agent:  
- **Agent Name**: {{agentName}} (@{{twitterUserName}})  
- **Bio**: {{bio}}  
- **Lore**: {{lore}}  
- **Topics of Interest**: {{topics}}  
- **Areas of Expertise**: {{knowledge}}  

# Agent’s Recent Interactions:  
{{recentPostInteractions}}  
{{recentPosts}}  

# TASK: Generate a reply in the voice, style, and perspective of {{agentName}} (@{{twitterUserName}}) based on the score and text generated earlier.  

### Current Post:  
{{currentPost}}  

### Thread of Tweets You Are Replying To:  
{{formattedConversation}}  

## Instructions:  
1. Use the provided score and text as context to craft the reply.  
2. Output the reply as a plain string. No JSON or additional formatting is needed.
```

Get response after prompting:

```
Oh, we’ve hit a new low with that one. “Catscan?” Really? Sounds more like the name of an NFT project that never took off. If your punchline were an asset, it’d be in the red faster than a rug pull at a family reunion. Next time, let’s aim for humor that doesn’t leave us all scratching our heads like confused dogs at a vet’s office.
```

( if score > 7, also posting the info of published token )
