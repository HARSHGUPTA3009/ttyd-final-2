Context - done
Task - done 
Dataset - done
Func Req - done
Guardrails & safety - done
Eval Harness - 
    16 questions - 12 answerable
                 - 1 ambigious
                 - 3 Unanswerable

Questions
a -
claude opus 5 & gpt go as a pair for logical thinking and bug handling 
Used for:
1. The logical battle, discussed and removed and added important states in the architecture and removed the over complex ones - supported for better research and development

2. Writing the basic template and structure, the scaffolding of the project the architecture flow components and models - as manual effort isnt required once you have the idea.

3.the web ui, obv it isnt req but helps in better expericence and easier tesing also added the visual logic and flow which shows the actual backend to a non dev too helps us for better state management and error state checkup

4. Used to write the smoke tests and edge cases

5. did run it locally but had no idea how it will handle the db on dpeloyment on vercel so upgraded to local setup to vercel one using claude

Things rejected:
1. over complex architecture

2. it added limit tag to all queries for standardization

3. I added reqex check for ddl sql commands it tried improving it and failed it 

4. ambiguity was working randomly, it just matching the keyword, handling it was fun and correcting too

5. it created offline planner when the api is off to run basic queries and hardcoded from the catalog but i didnt remove it as it was a good base condition but wasnt required

things i can not comfortable to defend on the spot:

1. The validating logic for the gaurdrailing the drop/invalid commands

2. The query to the Abstract syntax tree logic and complex part

b-
1. I separate SQL generation from answer generation, give the model semantic information about the data, and then ground every numeric claim in the actual query results.

2. 3 independent safety layers- parse and reject dangerous commands
                                readonly & query only by sqlite
                                verify the complied cmd
                                test and validate func 

3. fuzzy words or not directed ans
    less length of the input
    reasonable interpreations to the llm and then final guess
    indirect questions like asking ratio or margin instead of direct data or most popular without mentioning on what basis
    check that do different interpretations affect the final ans

c-
    Valid SQL, wrong meaning
    Silent loss of rows - inner join on null or not defined points
    Ambiguous/Unanswerable interpretation
    very large db as here 11 tables didnt affect any kind of performance pressure or depth to the flow we are working else 
    expanding columns joins and relevant then confidence score implementation would be a must

    bonus - added cache layer so same id gives you same result and also there can be cases
    same id and same res - final ans generation change / no change
    Different id - whole pipeline again
    same id , diff res - db changes / model generation changed

d-
    no safety net
    no schema retrieval
    no handling no ambiguity
    no limit 
    no ground
    can lead to dangerous failures and data breech and resources exchaust has no gurdrail


    blind trust
    no gaurdrails
    no retreival and direct implementation 


Failures - 1. claude did hardcoded limit implementations
           2. edge cases for ambiguity and unaswerable
           3. unimplemented cors and dotenv by claude fixed it
           4. the complex architecture bugs 
           5. 