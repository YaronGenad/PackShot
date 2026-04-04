/**
 * Gemini API client — three functions for AI-powered packshot generation.
 * Non-deterministic: results vary between runs. Requires paid API key.
 */

import { GoogleGenAI } from "@google/genai";

/** Generate studio packshot from source images — pure white bg, zero creativity. */
export async function generatePackshot(images: { base64: string, mimeType: string }[]) {
  // Create a new GoogleGenAI instance right before making an API call
  // to ensure it always uses the most up-to-date API key from the dialog.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const systemInstruction = `
    YOU ARE A TECHNICAL PRODUCT PHOTOGRAPHY SYNTHESIS ENGINE.
    YOUR GOAL IS TO CREATE A "PACKSHOT": A CLEAN, ACCURATE, AND PROFESSIONAL PRODUCT IMAGE FOR E-COMMERCE.
    
    STRICT TECHNICAL REQUIREMENTS:
    1. BACKGROUND: ABSOLUTE PURE WHITE (#FFFFFF). NO GRADIENTS, NO TEXTURES, NO PROPS.
    2. FIDELITY: THE PRODUCT MUST BE AN IDENTICAL REPLICA OF THE SOURCE. DO NOT ALTER SHAPE, LOGOS, TEXT, OR TEXTURES.
    3. CREATIVITY: ZERO CREATIVITY ALLOWED. DO NOT ADD WATER SPLASHES, SMOKE, LIGHT STREAKS, OR ARTISTIC ELEMENTS.
    4. LIGHTING: EVEN, NEUTRAL STUDIO LIGHTING. NO DRAMATIC COLOR GELS OR HARSH CONTRAST.
    5. FLOOR: THE PRODUCT SHOULD APPEAR TO BE SITTING ON A WHITE SURFACE. ONLY A TINY, SOFT CONTACT SHADOW IS ALLOWED DIRECTLY BENEATH THE PRODUCT. NO REFLECTIONS ON THE FLOOR.
    6. COMPOSITION: CENTERED, FRONT-FACING OR 3/4 VIEW. SHARP FOCUS EVERYWHERE.
    7. MULTIPLE OBJECTS: IF THE SOURCE CONTAINS MULTIPLE DISTINCT OBJECTS, MAINTAIN THEIR INDIVIDUALITY. DO NOT MERGE, CONNECT, OR FUSE THEM TOGETHER. KEEP THE SPATIAL RELATIONSHIP ACCURATE.
    8. NO EXTRAS: DO NOT ADD HANDS, MODELS, OR ANY DECORATIVE ELEMENTS.
  `;

  const prompt = `
    Generate a professional, commercial-grade packshot of the product shown in these images.
    Follow the system instructions strictly: PURE WHITE background, ZERO creativity, EXACT product fidelity.
    Create ONE high-quality "Hero Shot" that represents the product perfectly.
  `;

  const imageParts = images.map(img => ({
    inlineData: {
      data: img.base64,
      mimeType: img.mimeType
    }
  }));

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: {
        parts: [
          { text: prompt },
          ...imageParts
        ]
      },
      config: {
        systemInstruction,
        imageConfig: {
          aspectRatio: "1:1",
          imageSize: "1K"
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    
    throw new Error("No image generated in the response");
  } catch (error: any) {
    if (error.message?.includes("Requested entity was not found")) {
      // This might be a key selection issue, the caller should handle it.
      throw new Error("API_KEY_ERROR");
    }
    throw error;
  }
}

/** Balance lighting — reduce burnt highlights, lift dark shadows using source context. */
export async function homogenizePackshot(
  currentResultBase64: string, 
  sourceImages: { base64: string, mimeType: string }[],
  burntReduction: number = 15,
  darkIncrease: number = 15
) {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const systemInstruction = `
    YOU ARE A TECHNICAL PRODUCT PHOTOGRAPHY LIGHTING SPECIALIST.
    YOUR GOAL IS TO AGGRESSIVELY BUT NATURALLY BALANCE UNEVEN LIGHTING IN THE PROVIDED PRODUCT IMAGE.
    
    STRICT TECHNICAL REQUIREMENTS:
    1. HOMOGENIZATION: ACTIVELY NORMALIZE THE LIGHTING ACROSS THE PRODUCT. 
       - FOR OVEREXPOSED ("BURNT") HIGHLIGHTS: REDUCE BRIGHTNESS BY APPROXIMATELY ${burntReduction}% TO RECOVER DETAIL.
       - FOR UNDEREXPOSED ("DARK") SHADOWS: INCREASE BRIGHTNESS BY APPROXIMATELY ${darkIncrease}% TO REVEAL HIDDEN DETAIL.
    2. FIDELITY: MAINTAIN ABSOLUTE PRODUCT FIDELITY. DO NOT ALTER SHAPE, LOGOS, OR TEXTURES.
    3. BACKGROUND: KEEP THE BACKGROUND ABSOLUTE PURE WHITE (#FFFFFF).
    4. NO CREATIVITY: DO NOT ADD NEW ELEMENTS, REFLECTIONS, OR ARTISTIC EFFECTS.
    5. NATURAL LOOK: ENSURE THE TRANSITIONS BETWEEN ADJUSTED AREAS ARE SEAMLESS AND LOOK LIKE PROFESSIONAL STUDIO LIGHTING.
    6. SOURCE CONTEXT: USE THE PROVIDED SOURCE IMAGES TO UNDERSTAND THE TRUE COLORS AND TEXTURES OF THE PRODUCT WHILE FIXING THE LIGHTING.
  `;

  const prompt = `
    The current generated packshot has uneven lighting that needs correction. 
    Please apply a noticeable homogenization effect: 
    - Reduce the intensity of overexposed/burnt spots by ${burntReduction}%.
    - Lift the brightness of dark/shadowed areas by ${darkIncrease}%.
    The goal is a perfectly balanced, professional studio look where all parts of the product are clearly visible and evenly lit.
  `;

  const sourceParts = sourceImages.map(img => ({
    inlineData: {
      data: img.base64,
      mimeType: img.mimeType
    }
  }));

  const currentPart = {
    inlineData: {
      data: currentResultBase64.split(',')[1] || currentResultBase64,
      mimeType: "image/png"
    }
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: {
        parts: [
          { text: prompt },
          currentPart,
          ...sourceParts
        ]
      },
      config: {
        systemInstruction,
        imageConfig: {
          aspectRatio: "1:1",
          imageSize: "1K"
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    
    throw new Error("No image generated in the response");
  } catch (error: any) {
    if (error.message?.includes("Requested entity was not found")) {
      throw new Error("API_KEY_ERROR");
    }
    throw error;
  }
}

/** Apply targeted edit from user prompt — change color, remove label, etc. */
export async function editPackshot(currentResultBase64: string, sourceImages: { base64: string, mimeType: string }[], editPrompt: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const systemInstruction = `
    YOU ARE A TECHNICAL PRODUCT PHOTOGRAPHY EDITOR.
    YOUR GOAL IS TO APPLY A SPECIFIC MODIFICATION TO THE PROVIDED PRODUCT IMAGE BASED ON THE USER'S PROMPT.
    
    STRICT TECHNICAL REQUIREMENTS:
    1. TARGETED EDITING: ONLY APPLY THE CHANGE REQUESTED IN THE PROMPT. DO NOT ALTER ANY OTHER PART OF THE IMAGE.
    2. FIDELITY: MAINTAIN ABSOLUTE PRODUCT FIDELITY FOR EVERYTHING NOT BEING EDITED. DO NOT ALTER SHAPE, LOGOS, OR TEXTURES UNLESS EXPLICITLY ASKED.
    3. BACKGROUND: KEEP THE BACKGROUND ABSOLUTE PURE WHITE (#FFFFFF).
    4. NO CREATIVITY: ZERO CREATIVITY ALLOWED. DO NOT ADD ARTISTIC EFFECTS, PROPS, OR DECORATIVE ELEMENTS UNLESS EXPLICITLY ASKED.
    5. SOURCE CONTEXT: USE THE PROVIDED SOURCE IMAGES TO ENSURE THE EDITED PRODUCT REMAINS ACCURATE TO THE ORIGINAL PHYSICAL OBJECT.
  `;

  const prompt = `
    The user wants to modify the current packshot with this specific request: "${editPrompt}".
    Apply this change precisely while maintaining the professional studio quality and product accuracy.
  `;

  const sourceParts = sourceImages.map(img => ({
    inlineData: {
      data: img.base64,
      mimeType: img.mimeType
    }
  }));

  const currentPart = {
    inlineData: {
      data: currentResultBase64.split(',')[1] || currentResultBase64,
      mimeType: "image/png"
    }
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: {
        parts: [
          { text: prompt },
          currentPart,
          ...sourceParts
        ]
      },
      config: {
        systemInstruction,
        imageConfig: {
          aspectRatio: "1:1",
          imageSize: "1K"
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    
    throw new Error("No image generated in the response");
  } catch (error: any) {
    if (error.message?.includes("Requested entity was not found")) {
      throw new Error("API_KEY_ERROR");
    }
    throw error;
  }
}
