import Groq from "groq-sdk";
import { query } from "@/lib/db";
import { groqKeyManager } from "@/lib/groq-key-manager";

interface EnhancementOptions {
  subject: string;
  body: string;
  companyName: string;
  position?: string;
  recruiterName?: string;
  useAi?: boolean;
}

interface EnhancementResult {
  subject: string;
  body: string;
  aiEnhanced: boolean;
  message?: string;
  error?: string;
}

// Get active AI rules from database
async function getActiveAiRules(): Promise<string> {
  try {
    const result = await query(`
      SELECT rules_text 
      FROM ai_rules 
      WHERE is_active = true 
      ORDER BY created_at DESC 
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      // Return default rules if none found
      return `You are an email enhancement assistant. Your job is to improve job application emails while following these strict rules:

RULES:
1. NEVER add new content, projects, or information not already present
2. ONLY fix grammar, spelling, and awkward phrasing from placeholder replacements
3. Keep the same tone, style, and personality
4. Maintain all existing links, projects, and specific details exactly as they are
5. Do not make the email longer - keep it concise
6. Do not change the core message or structure
7. Only improve readability and flow

WHAT TO FIX:
- Grammar errors from placeholder replacements
- Awkward transitions between sentences
- Minor spelling mistakes
- Improve sentence flow without changing meaning

WHAT NOT TO DO:
- Add new sentences or paragraphs
- Change project descriptions
- Add new qualifications or skills
- Modify links or contact information
- Change the greeting or closing
- Add buzzwords or corporate speak

Keep the email authentic and personal. Only make minimal improvements.`;
    }

    return result.rows[0].rules_text;
  } catch (error) {
    console.error("Error fetching AI rules:", error);
    // Return default rules on error
    return `You are an email enhancement assistant. Your job is to improve job application emails while following these strict rules:

RULES:
1. NEVER add new content, projects, or information not already present
2. ONLY fix grammar, spelling, and awkward phrasing from placeholder replacements
3. Keep the same tone, style, and personality
4. Maintain all existing links, projects, and specific details exactly as they are
5. Do not make the email longer - keep it concise
6. Do not change the core message or structure
7. Only improve readability and flow

Keep the email authentic and personal. Only make minimal improvements.`;
  }
}

// Enhanced email processing function with multi-key support
export async function enhanceEmail(
  options: EnhancementOptions
): Promise<EnhancementResult> {
  const {
    subject,
    body,
    companyName,
    position,
    recruiterName,
    useAi = false,
  } = options;

  // If AI is disabled, return original content
  if (!useAi) {
    return {
      subject,
      body,
      aiEnhanced: false,
      message: "AI enhancement disabled",
    };
  }

  try {
    // Get an available API key using the key manager
    const apiKey = await groqKeyManager.getAvailableKey();

    if (!apiKey) {
      return {
        subject,
        body,
        aiEnhanced: false,
        error: "AI quota exceeded",
        message: "All API keys have reached their rate limits",
      };
    }

    // Log which key is being used (but mask it for security)
    const keyStats = await groqKeyManager.getKeyStats();
    const maskedKey =
      apiKey.slice(0, 4) + "*".repeat(apiKey.length - 8) + apiKey.slice(-4);
    console.log(
      `🎯 Using API key: ${maskedKey} | Remaining today: ${
        keyStats.totalDailyCapacity - keyStats.usedToday
      }`
    );

    // Get active AI rules
    const aiRules = await getActiveAiRules();

    // Create the enhancement prompt
    const prompt = `${aiRules}

Company: ${companyName}
Position: ${position || "Software Developer"}
Recruiter: ${recruiterName || "there"}

Email to enhance:
Subject: ${subject}
Body: ${body}

Please enhance this email following the rules above. Return the result in this exact format:
Subject: [enhanced subject]
Body: [enhanced body]`;

    // Initialize Groq client with the selected key
    const groq = new Groq({
      apiKey: apiKey,
    });

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      model: "llama3-8b-8192",
      temperature: 0.1, // Low temperature for consistency
      max_tokens: 500, // Conservative token limit
    });

    const aiResponse = completion.choices[0]?.message?.content;

    if (!aiResponse) {
      // Record failed usage
      await groqKeyManager.recordKeyUsage(apiKey, false, "no_response");
      throw new Error("No response from AI");
    }

    // Parse the AI response
    const subjectMatch = aiResponse.match(/Subject:\s*(.+)/);
    const bodyMatch = aiResponse.match(/Body:\s*([\s\S]+)/);

    let enhancedSubject = subject;
    let enhancedBody = body;

    if (subjectMatch) {
      enhancedSubject = subjectMatch[1].trim();
    }

    if (bodyMatch) {
      enhancedBody = bodyMatch[1].trim();
    }

    // Record successful usage
    await groqKeyManager.recordKeyUsage(apiKey, true);

    return {
      subject: enhancedSubject,
      body: enhancedBody,
      aiEnhanced: true,
      message: "Email enhanced successfully",
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Error enhancing email:", errorMessage);

    // Try to get the API key that was used for error recording
    const apiKey = await groqKeyManager.getAvailableKey();

    // Handle specific error types and record key usage
    if (
      errorMessage.includes("rate_limit_exceeded") ||
      errorMessage.includes("429")
    ) {
      if (apiKey) {
        await groqKeyManager.recordKeyUsage(
          apiKey,
          false,
          "rate_limit_exceeded"
        );
      }

      return {
        subject,
        body,
        aiEnhanced: false,
        error: "AI rate limit reached",
        message: "Rate limit exceeded on current key, will try next key",
      };
    }

    if (
      errorMessage.includes("insufficient_quota") ||
      errorMessage.includes("billing")
    ) {
      if (apiKey) {
        await groqKeyManager.recordKeyUsage(apiKey, false, "quota_exceeded");
      }

      return {
        subject,
        body,
        aiEnhanced: false,
        error: "AI quota exceeded",
        message: "Quota limit reached on current key",
      };
    }

    // Generic AI error
    if (apiKey) {
      await groqKeyManager.recordKeyUsage(apiKey, false, "generic_error");
    }

    return {
      subject,
      body,
      aiEnhanced: false,
      error: "AI enhancement failed",
      message: "AI temporarily unavailable, trying next key",
    };
  }
}
