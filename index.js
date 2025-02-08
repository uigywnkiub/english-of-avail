import fs from 'node:fs'
import readline from 'node:readline'
import { log, error } from 'node:console'
import { Octokit } from 'octokit'
import TelegramBot from 'node-telegram-bot-api'
import { GoogleGenerativeAI } from '@google/generative-ai'
import 'dotenv/config'

const {
  ENGLISH_OF_AVAIL_REPO_TOKEN,
  OWNER,
  REPOSITORY,
  LINE_NUMBER_VAR_NAME,
  DISABLE_WORKFLOW_VAR_NAME,
  GEMINI_API_KEY,
  GEMINI_MODEL,
  TG_TOKEN,
  TG_CHAT_ID,
} = process.env

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
const bot = new TelegramBot(TG_TOKEN, { polling: false })
const octokit = new Octokit({
  auth: ENGLISH_OF_AVAIL_REPO_TOKEN,
})
const AIModel = genAI.getGenerativeModel({
  model: GEMINI_MODEL,
  // Docs https://ai.google.dev/api/generate-content#v1beta.GenerationConfig
  generationConfig: {
    stopSequences: ['\n'],
    // A token is equivalent to about 4 characters for Gemini models. 100 tokens are about 60-80 English words.
    maxOutputTokens: 40,
    // temperature: 0.5,
  },
  // safetySettings,
})

async function getLineNumber() {
  try {
    const res = await octokit.request(
      'GET /repos/{owner}/{repo}/actions/variables/{variable}',
      {
        owner: OWNER,
        repo: REPOSITORY,
        variable: LINE_NUMBER_VAR_NAME,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    )
    const lineNum = res.data.value
    if (lineNum < 1) {
      error(
        'Github variable `line number` must be 1 or more, upper and snake case.'
      )
      process.exit(1)
    }
    return parseInt(lineNum, 10)
  } catch (err) {
    // if (
    //   err.response.data.message === 'Not Found' ||
    //   err.response.data.status === '404'
    // ) {
    //   error('Not found or status 404. Return 1.')
    //   return 1
    // }
    error(err)
    process.exit(1)
  }
}

async function createDisableWorkflowVariable() {
  try {
    await octokit.request(
      'PATCH /repos/{owner}/{repo}/actions/variables/{variable}',
      {
        owner: OWNER,
        repo: REPOSITORY,
        variable: DISABLE_WORKFLOW_VAR_NAME,
        value: 'true',
        headers: {
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    )
  } catch (err) {
    error(err)
    process.exit(1)
  }
}

function getLineByNumber(filePath, lineNum, callback) {
  try {
    const file = fs.createReadStream(filePath)
    const rl = readline.createInterface({
      input: file,
      crlfDelay: Infinity,
    })

    let currLine = 0

    rl.on('line', (line) => {
      currLine++
      if (currLine === lineNum) {
        callback(line) // Pass the line to the callback
        rl.close() // Stop reading once the desired line is found
      }
    })

    rl.on('close', async () => {
      if (currLine < lineNum) {
        error(
          `Dictionary file contains ${currLine} lines, but received ${lineNum}.`
        )

        await createDisableWorkflowVariable()

        process.exit(1)
      }
    })
  } catch (err) {
    error(err)
    process.exit(1)
  }
}

async function getAIText(prompt) {
  try {
    const content = await AIModel.generateContent(prompt)
    return content.response.text().trim()
  } catch (err) {
    error(err)
    process.exit(1)
  }
}

function capitalizeFirstLetter(text) {
  return `${text?.[0].toUpperCase()}${text?.substring(1)}` ?? ''
}

function formatMessage(emoji, boldText, hiddenText) {
  const bold = `*${capitalizeFirstLetter(boldText)}*`
  const hidden = `||${capitalizeFirstLetter(hiddenText)}||`
  return `${emoji}\n\n${bold}\n\n${hidden}`
}

async function main() {
  const lineNum = await getLineNumber()
  const filePath = `${process.cwd()}/dictionary/NGSL_1.2/NGSL_1.2_alphabetized_description.txt`

  getLineByNumber(filePath, lineNum, async (line) => {
    log(`Line ${lineNum}:`, line)

    const [emojiLine, translatedLine] = await Promise.all([
      getAIText(
        `Please provide only one emoji representing the word (no extra text): [${line}]
        If there isn't a single, clear emoji representation, choose the closest or most relevant one. If there is no appropriate emoji, return [🤔].`
      ),
      getAIText(
        `Translate the following English word to Ukrainian. Please provide only the translated word or words (no extra text): [${line}]`
      ),
    ])

    const message = formatMessage(emojiLine, line, translatedLine)

    bot.sendMessage(TG_CHAT_ID, message, {
      allow_sending_without_reply: true,
      reply_to_message_id: false,
      protect_content: true,
      parse_mode: 'MarkdownV2',
    })
  })
}

main()
