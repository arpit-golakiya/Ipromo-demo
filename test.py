import base64
import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_PATH = os.path.join(SCRIPT_DIR, r"C:\Users\Linux\Downloads\662aa16c67a02ff0fc8901e5754b1b08af8d3ce2f38f6180ac4f52ee197c6595.webp")
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "output")
OUTPUT_PATH = os.path.join(OUTPUT_DIR, "cleaned.png")

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def remove_logo_gpt4o(input_path: str, output_path: str):
    with open(input_path, "rb") as f:
        image_b64 = base64.b64encode(f.read()).decode("utf-8")

    ext = os.path.splitext(input_path)[1].lower()
    media_type = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"

    print("⏳ Sending image to GPT-4o for logo removal...")

    response = client.responses.create(
        model="gpt-5",
        input=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_image",
                        "image_url": f"data:{media_type};base64,{image_b64}",
                    },
                    {
                        "type": "input_text",
                        "text": (
                        """You are an expert product image editor.

                        TASK:
                        Transform the given image into a professional e-commerce product photo of ONLY the t-shirt.

                        STRICT INSTRUCTIONS:
                        - Completely remove any human, model, face, arms, or body parts
                        - Remove ALL logos, text, branding, graphics, or prints from the t-shirt
                        - Preserve the EXACT original t-shirt color (do not change color)
                        - Preserve fabric texture and natural folds as much as possible
                        - Reconstruct missing areas realistically (no blur, no artifacts)

                        OUTPUT REQUIREMENTS:
                        - Only a plain t-shirt (no person)
                        - Centered, front-facing
                        - Clean, symmetrical shape
                        - Studio lighting
                        - Plain white or light neutral background
                        - High-quality e-commerce style image

                        IMPORTANT:
                        - Do NOT add new logos or designs
                        - Do NOT change t-shirt type
                        - Do NOT hallucinate extra elements"""
                        ),
                    },
                ],
            }
        ],
        tools=[{"type": "image_generation"}]
    )

    # Extract image from response
    image_data = None
    for block in response.output:
        if block.type == "image_generation_call":
            image_data = block.result
            break

    if not image_data:
        print("❌ No image returned. GPT-4o may not have made edits.")
        return

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(base64.b64decode(image_data))

    print(f"✅ Done! Saved at: {output_path}")


if __name__ == "__main__":
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    remove_logo_gpt4o(INPUT_PATH, OUTPUT_PATH)