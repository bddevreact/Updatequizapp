// AI Question Service
// This service handles AI-generated questions using OpenAI API

const OpenAI = require('openai');

class AIQuestionService {
  constructor() {
    this.openai = null;
    this.isInitialized = false;
    this.initializeOpenAI();
  }

  // Initialize OpenAI client
  initializeOpenAI() {
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (apiKey && apiKey !== 'sk-your-openai-api-key-here') {
        this.openai = new OpenAI({
          apiKey: apiKey
        });
        this.isInitialized = true;
        console.log('OpenAI client initialized successfully');
      } else {
        console.log('OpenAI API key not configured, using mock questions');
        this.isInitialized = false;
      }
    } catch (error) {
      console.error('Error initializing OpenAI:', error);
      this.isInitialized = false;
    }
  }

  // Generate AI question
  async generateQuestion(difficulty = 'medium', category = 'general') {
    try {
      if (!this.isInitialized) {
        return this.getMockQuestion(difficulty, category);
      }

      const prompt = this.buildPrompt(difficulty, category);
      
      const response = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are an expert quiz question generator specializing in cryptocurrency and blockchain topics. Generate educational, accurate, and engaging quiz questions.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 500,
        temperature: 0.7
      });

      const content = response.choices[0].message.content;
      return this.parseQuestionResponse(content);
    } catch (error) {
      console.error('Error generating AI question:', error);
      return this.getMockQuestion(difficulty, category);
    }
  }

  // Build prompt for AI
  buildPrompt(difficulty, category) {
    const difficultyInstructions = {
      easy: 'Create a basic question suitable for beginners. Use simple language and focus on fundamental concepts.',
      medium: 'Create an intermediate question that requires some knowledge. Include technical terms but explain them.',
      hard: 'Create an advanced question for experts. Use complex technical concepts and require deep understanding.'
    };

    const categoryInstructions = {
      general: 'Focus on general cryptocurrency and blockchain concepts',
      bitcoin: 'Focus specifically on Bitcoin-related topics',
      ethereum: 'Focus specifically on Ethereum and smart contracts',
      trading: 'Focus on trading, markets, and financial aspects',
      technology: 'Focus on technical implementation and blockchain technology',
      security: 'Focus on security, wallets, and best practices'
    };

    return `Generate a ${difficulty} difficulty quiz question about ${category} cryptocurrency topics.

${difficultyInstructions[difficulty] || difficultyInstructions.medium}
${categoryInstructions[category] || categoryInstructions.general}

Please format your response as JSON with the following structure:
{
  "question": "Your question here?",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "correct": 0,
  "explanation": "Detailed explanation of the correct answer",
  "category": "${category}",
  "difficulty": "${difficulty}"
}

Make sure the question is accurate, educational, and the correct answer is clearly identifiable.`;
  }

  // Parse AI response
  parseQuestionResponse(content) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const questionData = JSON.parse(jsonMatch[0]);
        return {
          success: true,
          question: questionData
        };
      } else {
        throw new Error('No valid JSON found in response');
      }
    } catch (error) {
      console.error('Error parsing AI response:', error);
      return {
        success: false,
        error: 'Failed to parse AI response',
        question: this.getMockQuestion('medium', 'general')
      };
    }
  }

  // Get mock question when AI is not available
  getMockQuestion(difficulty, category) {
    const mockQuestions = {
      easy: {
        question: "What is Bitcoin?",
        options: [
          "A digital currency",
          "A physical coin",
          "A bank account",
          "A credit card"
        ],
        correct: 0,
        explanation: "Bitcoin is a decentralized digital currency that operates without a central bank or single administrator.",
        category: category,
        difficulty: difficulty
      },
      medium: {
        question: "What is a blockchain?",
        options: [
          "A type of cryptocurrency",
          "A distributed ledger technology",
          "A mining rig",
          "A wallet application"
        ],
        correct: 1,
        explanation: "A blockchain is a distributed ledger technology that maintains a continuously growing list of records.",
        category: category,
        difficulty: difficulty
      },
      hard: {
        question: "What is the purpose of a Merkle tree in blockchain?",
        options: [
          "To store transaction data",
          "To verify data integrity efficiently",
          "To mine new blocks",
          "To create smart contracts"
        ],
        correct: 1,
        explanation: "Merkle trees allow efficient verification of data integrity in blockchain by creating a hash tree structure.",
        category: category,
        difficulty: difficulty
      }
    };

    return {
      success: true,
      question: mockQuestions[difficulty] || mockQuestions.medium
    };
  }

  // Generate multiple questions
  async generateQuestions(count = 5, difficulty = 'medium', category = 'general') {
    try {
      const questions = [];
      for (let i = 0; i < count; i++) {
        const result = await this.generateQuestion(difficulty, category);
        if (result.success) {
          questions.push(result.question);
        }
      }
      return {
        success: true,
        questions: questions
      };
    } catch (error) {
      console.error('Error generating multiple questions:', error);
      return {
        success: false,
        error: error.message,
        questions: []
      };
    }
  }

  // Validate question quality
  validateQuestion(question) {
    const errors = [];
    
    if (!question.question || question.question.length < 10) {
      errors.push('Question text is too short');
    }
    
    if (!question.options || question.options.length !== 4) {
      errors.push('Question must have exactly 4 options');
    }
    
    if (typeof question.correct !== 'number' || question.correct < 0 || question.correct > 3) {
      errors.push('Correct answer must be a number between 0 and 3');
    }
    
    if (!question.explanation || question.explanation.length < 20) {
      errors.push('Explanation is too short');
    }
    
    return {
      isValid: errors.length === 0,
      errors: errors
    };
  }

  // Get service status
  getStatus() {
    return {
      initialized: this.isInitialized,
      hasOpenAI: !!this.openai,
      apiKeyConfigured: !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'sk-your-openai-api-key-here'
    };
  }
}

// Create singleton instance
const aiQuestionService = new AIQuestionService();

module.exports = aiQuestionService;
